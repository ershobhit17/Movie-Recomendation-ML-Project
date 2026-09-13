"""FastAPI application for the CineMatch movie recommendation experience.

Enriches local machine-learning content recommendations with live OMDb
metadata while strictly protecting the OMDb API key on the backend.
"""
from contextlib import asynccontextmanager
import os
from pathlib import Path
from typing import Annotated, Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from recommender import MovieRecommender

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

OMDB_URL = os.getenv("OMDB_BASE_URL", "https://www.omdbapi.com/")
OMDB_KEY = os.getenv("OMDB_API_KEY", "")

# In-memory cache for OMDb responses to preserve API quota and improve response speed
_omdb_cache: Dict[str, Dict[str, Any]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.recommender = MovieRecommender()
    yield


app = FastAPI(
    title="CineMatch API",
    description="Content-Based Movie Recommendation Engine enriched with OMDb metadata",
    version="1.1.0",
    lifespan=lifespan,
)

# Enable CORS for local development flexibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


async def fetch_omdb_details(title: str) -> Dict[str, Any]:
    """Fetch movie metadata from OMDb securely without ever leaking the API key."""
    if not OMDB_KEY:
        return {}

    cache_key = title.casefold().strip()
    if cache_key in _omdb_cache:
        return _omdb_cache[cache_key]

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                OMDB_URL,
                params={"t": title, "apikey": OMDB_KEY, "plot": "full"},
            )
            response.raise_for_status()
            data = response.json()

            if data.get("Response") == "True":
                poster = data.get("Poster", "")
                if poster == "N/A":
                    poster = ""

                # Extract Rotten Tomatoes if available
                rotten_tomatoes = ""
                for rating_obj in data.get("Ratings", []):
                    if rating_obj.get("Source") == "Rotten Tomatoes":
                        rotten_tomatoes = rating_obj.get("Value", "")

                result = {
                    "poster": poster,
                    "year": data.get("Year", ""),
                    "runtime": data.get("Runtime", ""),
                    "rated": data.get("Rated", ""),
                    "director": data.get("Director", ""),
                    "actors": data.get("Actors", ""),
                    "plot": data.get("Plot", ""),
                    "imdb_rating": data.get("imdbRating", ""),
                    "imdb_votes": data.get("imdbVotes", ""),
                    "imdb_id": data.get("imdbID", ""),
                    "box_office": data.get("BoxOffice", ""),
                    "awards": data.get("Awards", ""),
                    "rotten_tomatoes": rotten_tomatoes,
                }
                _omdb_cache[cache_key] = result
                return result
    except (httpx.HTTPError, ValueError):
        pass

    return {}


@app.get("/api/health")
async def health() -> Dict[str, Any]:
    """Return system health status without exposing sensitive credentials."""
    recommender: MovieRecommender = app.state.recommender
    return {
        "status": "online",
        "catalog_source": recommender.source,
        "total_movies": recommender.movie_count,
        "omdb_configured": bool(OMDB_KEY),
        "cached_titles": len(_omdb_cache),
    }


@app.get("/api/search")
async def search(q: Annotated[str, Query(min_length=1, max_length=100)]) -> Dict[str, Any]:
    """Provide title autocomplete suggestions with genres and ratings."""
    recommender: MovieRecommender = app.state.recommender
    matches = recommender.search(q, limit=8)
    return {"query": q, "results": matches}


@app.get("/api/movie/{title}")
async def get_movie_detail(title: str) -> Dict[str, Any]:
    """Get full details for a single movie combining local dataset and OMDb."""
    recommender: MovieRecommender = app.state.recommender
    local = recommender.get_movie(title) or {"title": title}
    omdb = await fetch_omdb_details(title)
    
    # Merge metadata prioritizing OMDb where richer
    combined = {**local, **omdb}
    return combined


@app.get("/api/recommendations")
async def recommendations(
    title: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=16)] = 6,
) -> Dict[str, Any]:
    """Calculate and return content-based recommendations enriched with OMDb metadata."""
    recommender: MovieRecommender = app.state.recommender
    try:
        movies = recommender.recommend(title, limit=limit)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    # Fetch seed movie details as well
    seed_details = await fetch_omdb_details(title)

    # Enrich recommendations with OMDb details
    enriched: List[Dict[str, Any]] = []
    for movie in movies:
        movie_title = movie["title"]
        omdb_data = await fetch_omdb_details(movie_title)
        
        # Merge, retaining model fields like similarity and fallback overview
        enriched_movie = {
            **movie,
            "poster": omdb_data.get("poster", ""),
            "year": omdb_data.get("year", ""),
            "runtime": omdb_data.get("runtime", ""),
            "director": omdb_data.get("director", ""),
            "actors": omdb_data.get("actors", ""),
            "imdb_rating": omdb_data.get("imdb_rating", "") or (f"{movie['rating']:.1f}" if movie.get("rating") else ""),
            "imdb_id": omdb_data.get("imdb_id", ""),
            "rotten_tomatoes": omdb_data.get("rotten_tomatoes", ""),
            # Use OMDb plot if available, else local overview
            "plot": omdb_data.get("plot") or movie.get("overview", ""),
        }
        enriched.append(enriched_movie)

    return {
        "seed": title,
        "seed_info": seed_details,
        "count": len(enriched),
        "recommendations": enriched,
    }


@app.get("/")
async def home() -> FileResponse:
    """Serve the single-page application with cache-busting headers."""
    return FileResponse(
        ROOT / "static" / "index.html",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
