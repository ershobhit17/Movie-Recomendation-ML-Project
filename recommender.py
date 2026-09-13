"""Content-based Movie Recommendation Engine.

Supports both pre-trained model artifacts (from Kaggle's 45k movies dataset)
and the instant starter catalog with TF-IDF Vectorization and Cosine Similarity.
"""
from pathlib import Path
import pickle
from typing import Any, Dict, List, Optional

import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

ROOT = Path(__file__).parent


class MovieRecommender:
    def __init__(self) -> None:
        self.movies: pd.DataFrame = pd.DataFrame()
        self.matrix: Any = None
        self.source: str = "starter catalog"
        self._load_catalog()

    def _load_catalog(self) -> None:
        artifact_dir = ROOT / "artifacts"
        
        # Check standard artifact paths
        movies_file = artifact_dir / "movies.pkl"
        matrix_file = artifact_dir / "tfidf_matrix.pkl"
        alt_movies = ROOT / "df.pkl"
        alt_matrix = ROOT / "tfidf_matrix.pkl"

        if movies_file.exists() and matrix_file.exists():
            self.movies = pd.read_pickle(movies_file).fillna("")
            with matrix_file.open("rb") as f:
                self.matrix = pickle.load(f)
            self.source = "trained dataset"
        elif alt_movies.exists() and alt_matrix.exists():
            self.movies = pd.read_pickle(alt_movies).fillna("")
            with alt_matrix.open("rb") as f:
                self.matrix = pickle.load(f)
            self.source = "trained dataset"
        else:
            # Fallback to starter catalog
            csv_path = ROOT / "data" / "sample_movies.csv"
            if csv_path.exists():
                self.movies = pd.read_csv(csv_path).fillna("")
            else:
                self.movies = pd.DataFrame(columns=["title", "overview", "genres", "tagline", "vote_average"])
            
            tags = (
                self.movies.get("overview", "").astype(str) + " " +
                self.movies.get("genres", "").astype(str) + " " +
                self.movies.get("tagline", "").astype(str)
            )
            vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), max_features=10000)
            self.matrix = vectorizer.fit_transform(tags)
            self.source = f"starter catalog ({len(self.movies)} movies)"

        # Normalize titles for fast lookup
        self.movies["_normalized_title"] = self.movies["title"].astype(str).str.casefold().str.strip()
        self.movie_count = len(self.movies)

    def search(self, query: str, limit: int = 8) -> List[Dict[str, Any]]:
        """Search titles with autocomplete scoring (starts-with ranks above contains)."""
        query = query.casefold().strip()
        if not query:
            return []

        # Find prefix matches first, then substring matches
        starts = self.movies[self.movies["_normalized_title"].str.startswith(query)]
        contains = self.movies[self.movies["_normalized_title"].str.contains(query, regex=False)]
        
        matches = pd.concat([starts, contains]).drop_duplicates(subset=["title"]).head(limit)
        results = []
        for _, row in matches.iterrows():
            genres_raw = str(row.get("genres", ""))
            genres_list = [g.strip() for g in genres_raw.split() if g.strip()][:3]
            results.append({
                "title": str(row["title"]),
                "genres": genres_list,
                "rating": float(row.get("vote_average", 0) or 0)
            })
        return results

    def get_movie(self, title: str) -> Optional[Dict[str, Any]]:
        """Fetch local record for a movie."""
        clean = title.casefold().strip()
        match = self.movies[self.movies["_normalized_title"] == clean]
        if match.empty:
            # Fuzzy match fallback
            match = self.movies[self.movies["_normalized_title"].str.contains(clean, regex=False)]
        if match.empty:
            return None
        row = match.iloc[0]
        genres_raw = str(row.get("genres", ""))
        genres = [g.strip() for g in genres_raw.split() if g.strip()]
        return {
            "title": str(row["title"]),
            "overview": str(row.get("overview", "")),
            "genres": genres,
            "rating": float(row.get("vote_average", 0) or 0),
            "tagline": str(row.get("tagline", ""))
        }

    def recommend(self, title: str, limit: int = 6) -> List[Dict[str, Any]]:
        """Calculate content-based recommendations using cosine similarity."""
        clean = title.casefold().strip()
        match = self.movies.index[self.movies["_normalized_title"] == clean]
        
        if match.empty:
            # Try substring match
            sub = self.movies.index[self.movies["_normalized_title"].str.contains(clean, regex=False)]
            if sub.empty:
                raise LookupError(f"'{title}' was not found in the movie catalog.")
            index = sub[0]
        else:
            index = match[0]

        # Calculate cosine similarity of target movie against all movies
        scores = cosine_similarity(self.matrix[index], self.matrix).ravel()
        ranked = scores.argsort()[::-1]

        recommendations: List[Dict[str, Any]] = []
        for item_index in ranked:
            if item_index == index:
                continue
            movie = self.movies.iloc[item_index]
            genres_raw = str(movie.get("genres", ""))
            genres = [g.strip() for g in genres_raw.split() if g.strip()]
            
            similarity_pct = max(1, min(99, round(float(scores[item_index]) * 100)))
            
            recommendations.append({
                "title": str(movie["title"]),
                "overview": str(movie.get("overview", "")),
                "genres": genres,
                "rating": float(movie.get("vote_average", 0) or 0),
                "similarity": similarity_pct,
                "tagline": str(movie.get("tagline", ""))
            })
            if len(recommendations) >= limit:
                break

        return recommendations
