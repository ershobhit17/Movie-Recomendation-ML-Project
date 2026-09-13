"""Training pipeline to build recommendation artifacts from movies_metadata.csv."""
from pathlib import Path
import argparse
import ast
import os
import pickle
import re

import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer

ROOT = Path(__file__).parent


def parse_genres(value: object) -> str:
    """Parse JSON or string representations of genres."""
    if not isinstance(value, str) or not value.strip():
        return ""
    try:
        parsed = ast.literal_eval(value)
        if isinstance(parsed, list):
            names = [str(item.get("name", "")) for item in parsed if isinstance(item, dict)]
            return " ".join(names)
    except (ValueError, SyntaxError):
        pass
    return str(value)


def clean_text(text: str) -> str:
    """Remove special characters, lower-case, and standardize whitespace."""
    clean = re.sub(r"[^\w\s]", " ", str(text).lower())
    return " ".join(clean.split())


def build(source: Path, output: Path, max_samples: int = None) -> None:
    """Read dataset, clean features, compute TF-IDF matrix, and export pickle artifacts."""
    if not source.exists():
        # Check standard fallback path
        fallback = Path.home() / "Downloads" / "movies_metadata.csv"
        if fallback.exists():
            print(f"Source not found at {source}, using fallback: {fallback}")
            source = fallback
        else:
            raise FileNotFoundError(f"Source file not found at {source} or {fallback}")

    print(f"Loading raw dataset from {source}...")
    raw = pd.read_csv(source, low_memory=False)
    print(f"Loaded {len(raw):,} rows.")

    required = {"title", "overview", "genres", "tagline", "vote_average", "popularity"}
    missing = required - set(raw.columns)
    if missing:
        raise ValueError(f"Dataset is missing required columns: {', '.join(sorted(missing))}")

    # Drop null and duplicate titles
    df = raw[list(required)].copy()
    df = df.dropna(subset=["title"])
    df = df.drop_duplicates(subset=["title"]).reset_index(drop=True)

    if max_samples and len(df) > max_samples:
        print(f"Subsampling top {max_samples:,} movies by popularity...")
        df["popularity_numeric"] = pd.to_numeric(df["popularity"], errors="coerce").fillna(0)
        df = df.sort_values("popularity_numeric", ascending=False).head(max_samples).reset_index(drop=True)
        df = df.drop(columns=["popularity_numeric"])

    df["overview"] = df["overview"].fillna("")
    df["tagline"] = df["tagline"].fillna("")
    df["genres"] = df["genres"].apply(parse_genres)

    print("Synthesizing unified metadata tags...")
    df["tags"] = (df["overview"] + " " + df["genres"] + " " + df["tagline"]).map(clean_text)

    print("Fitting TF-IDF Vectorizer (unigrams + bigrams, 50,000 max features)...")
    vectorizer = TfidfVectorizer(max_features=50_000, ngram_range=(1, 2), stop_words="english")
    matrix = vectorizer.fit_transform(df["tags"])

    output.mkdir(parents=True, exist_ok=True)

    print(f"Exporting artifacts to {output}...")
    df.to_pickle(output / "movies.pkl")
    df.to_pickle(output / "df.pkl")
    
    indices = pd.Series(df.index, index=df["title"]).drop_duplicates()
    with (output / "indices.pkl").open("wb") as f:
        pickle.dump(indices, f)

    with (output / "tfidf_matrix.pkl").open("wb") as f:
        pickle.dump(matrix, f)

    with (output / "tfidf.pkl").open("wb") as f:
        pickle.dump(vectorizer, f)

    print(f"Successfully trained and serialized {len(df):,} movies to {output}!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train the CineMatch movie recommendation engine.")
    parser.add_argument("--input", default="movies_metadata.csv", help="Path to movies_metadata.csv")
    parser.add_argument("--output", default="artifacts", help="Destination folder for .pkl artifacts")
    parser.add_argument("--max-samples", type=int, default=None, help="Optional limit on number of movies")
    args = parser.parse_args()
    build(Path(args.input), Path(args.output), args.max_samples)
