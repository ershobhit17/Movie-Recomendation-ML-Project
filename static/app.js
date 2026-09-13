/**
 * CineMatch — Frontend Application Logic
 * Integrates with FastAPI endpoints:
 * - GET /api/health
 * - GET /api/search?q=...
 * - GET /api/recommendations?title=...&limit=...
 * - GET /api/movie/:title
 */

// DOM Elements
const movieInput = document.getElementById('movie-input');
const clearSearchBtn = document.getElementById('clear-search-btn');
const searchBtn = document.getElementById('search-btn');
const suggestionsDropdown = document.getElementById('suggestions-dropdown');
const chipsContainer = document.getElementById('chips-container');

const resultsSection = document.getElementById('results-section');
const seedTitleDisplay = document.getElementById('seed-title-display');
const resultsStats = document.getElementById('results-stats');
const limitSelect = document.getElementById('limit-select');
const resetResultsBtn = document.getElementById('reset-results-btn');
const movieGrid = document.getElementById('movie-grid');

const catalogPill = document.getElementById('catalog-pill');
const catalogStatusText = document.getElementById('catalog-status-text');
const omdbPill = document.getElementById('omdb-pill');
const omdbStatusText = document.getElementById('omdb-status-text');

const movieModal = document.getElementById('movie-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalContent = document.getElementById('modal-content');
const toastContainer = document.getElementById('toast-container');

// State
let searchDebounceTimer = null;
let currentSelectedIndex = -1;
let currentSuggestions = [];
let currentSeed = '';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkBackendHealth();
  attachEventListeners();
});

/**
 * Check backend status and display catalog and OMDb configuration
 */
async function checkBackendHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error('Health check failed');
    const data = await res.json();
    
    catalogStatusText.textContent = `${data.total_movies.toLocaleString()} Movies Ready`;
    
    if (data.omdb_configured) {
      omdbStatusText.textContent = 'OMDb Active';
      omdbPill.classList.remove('disabled');
    } else {
      omdbStatusText.textContent = 'OMDb Inactive';
      omdbPill.classList.add('disabled');
    }
  } catch {
    catalogStatusText.textContent = 'Offline';
    omdbStatusText.textContent = 'No connection';
  }
}

/**
 * Attach UI event listeners
 */
function attachEventListeners() {
  // Input search & autocomplete
  movieInput.addEventListener('input', handleInputChange);
  movieInput.addEventListener('keydown', handleInputKeydown);
  
  // Clear search button
  clearSearchBtn.addEventListener('click', () => {
    movieInput.value = '';
    clearSearchBtn.hidden = true;
    closeDropdown();
    movieInput.focus();
  });

  // Recommend button
  searchBtn.addEventListener('click', () => {
    submitSearch(movieInput.value.trim());
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box-card')) {
      closeDropdown();
    }
  });

  // Discovery chips
  chipsContainer.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
      const title = chip.dataset.title;
      movieInput.value = title;
      clearSearchBtn.hidden = false;
      submitSearch(title);
    }
  });

  // Limit change
  limitSelect.addEventListener('change', () => {
    if (currentSeed) {
      fetchRecommendations(currentSeed, parseInt(limitSelect.value, 10));
    }
  });

  // Reset button
  resetResultsBtn.addEventListener('click', () => {
    resultsSection.hidden = true;
    resultsSection.style.display = 'none';
    movieGrid.innerHTML = '';
    movieInput.value = '';
    clearSearchBtn.hidden = true;
    currentSeed = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    movieInput.focus();
  });

  // Modal close handlers
  modalCloseBtn.addEventListener('click', closeModal);
  movieModal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

/**
 * Handle debounced typing in search input
 */
function handleInputChange() {
  const query = movieInput.value.trim();
  clearSearchBtn.hidden = !query;

  clearTimeout(searchDebounceTimer);
  if (!query) {
    closeDropdown();
    return;
  }

  searchDebounceTimer = setTimeout(() => {
    fetchSuggestions(query);
  }, 160);
}

/**
 * Keyboard navigation for autocomplete list
 */
function handleInputKeydown(e) {
  if (suggestionsDropdown.hidden || currentSuggestions.length === 0) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitSearch(movieInput.value.trim());
    }
    return;
  }

  const items = suggestionsDropdown.querySelectorAll('.suggestion-item');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    currentSelectedIndex = (currentSelectedIndex + 1) % items.length;
    updateSelectedSuggestion(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    currentSelectedIndex = (currentSelectedIndex - 1 + items.length) % items.length;
    updateSelectedSuggestion(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (currentSelectedIndex >= 0 && currentSelectedIndex < currentSuggestions.length) {
      selectSuggestion(currentSuggestions[currentSelectedIndex].title);
    } else {
      submitSearch(movieInput.value.trim());
    }
  } else if (e.key === 'Escape') {
    closeDropdown();
  }
}

function updateSelectedSuggestion(items) {
  items.forEach((item, idx) => {
    if (idx === currentSelectedIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
      movieInput.value = currentSuggestions[idx].title;
    } else {
      item.classList.remove('selected');
    }
  });
}

/**
 * Fetch autocomplete suggestions from backend
 */
async function fetchSuggestions(query) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return;
    const data = await res.json();
    currentSuggestions = data.results || [];
    renderSuggestions(currentSuggestions);
  } catch {
    closeDropdown();
  }
}

/**
 * Render autocomplete suggestions dropdown
 */
function renderSuggestions(suggestions) {
  if (!suggestions || suggestions.length === 0) {
    closeDropdown();
    return;
  }

  currentSelectedIndex = -1;
  suggestionsDropdown.innerHTML = suggestions
    .map(
      (item) => `
      <div class="suggestion-item" data-title="${escapeHtml(item.title)}">
        <div class="suggestion-info">
          <span class="suggestion-icon">🎬</span>
          <span class="suggestion-title">${escapeHtml(item.title)}</span>
        </div>
        <div class="suggestion-meta">
          ${
            item.genres && item.genres[0]
              ? `<span class="suggestion-genre">${escapeHtml(item.genres[0])}</span>`
              : ''
          }
          ${item.rating ? `<span class="suggestion-rating">★ ${item.rating.toFixed(1)}</span>` : ''}
        </div>
      </div>
    `
    )
    .join('');

  suggestionsDropdown.querySelectorAll('.suggestion-item').forEach((item) => {
    item.addEventListener('click', () => {
      selectSuggestion(item.dataset.title);
    });
  });

  suggestionsDropdown.hidden = false;
}

function selectSuggestion(title) {
  movieInput.value = title;
  clearSearchBtn.hidden = false;
  closeDropdown();
  submitSearch(title);
}

function closeDropdown() {
  suggestionsDropdown.hidden = true;
  currentSelectedIndex = -1;
}

/**
 * Initiate search submission
 */
function submitSearch(title) {
  closeDropdown();
  if (!title) {
    movieInput.focus();
    showToast('Please enter a movie title to search.');
    return;
  }
  const limit = parseInt(limitSelect.value, 10) || 6;
  fetchRecommendations(title, limit);
}

/**
 * Fetch recommendations from /api/recommendations
 */
async function fetchRecommendations(title, limit = 6) {
  currentSeed = title;
  seedTitleDisplay.textContent = title;
  resultsStats.textContent = 'Finding movies with the same vibe and storyline...';

  // Reveal results container
  resultsSection.hidden = false;
  resultsSection.style.display = 'block';

  // Render shimmer skeleton cards directly inside movieGrid
  movieGrid.innerHTML = `
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
  `;
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res = await fetch(
      `/api/recommendations?title=${encodeURIComponent(title)}&limit=${limit}`
    );
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || 'Movie not found in catalog.');
    }

    renderRecommendations(data);
  } catch (err) {
    resultsStats.textContent = err.message;
    movieGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background: white; border-radius: 14px; border: 1px dashed var(--c-sage);">
        <p style="font-size: 1.4rem; margin-bottom: 8px;">🔍</p>
        <h3 style="color: var(--c-forest); margin-bottom: 8px;">Title Not Found</h3>
        <p style="color: var(--c-text-muted); max-width: 480px; margin: 0 auto 16px;">
          ${escapeHtml(err.message)}
        </p>
        <p style="font-size: 0.85rem; color: var(--c-text-subtle);">
          Try searching for one of our quick picks like <strong>Inception</strong>, <strong>Interstellar</strong>, or <strong>Spirited Away</strong>.
        </p>
      </div>
    `;
    showToast(err.message);
  }
}

/**
 * Render recommendation cards into grid
 */
function renderRecommendations(data) {
  const count = data.recommendations.length;
  resultsStats.textContent = `${count} curated films recommended based on story, genre, and mood.`;

  if (count === 0) {
    movieGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; padding: 30px;">No recommendations found.</p>`;
    return;
  }

  movieGrid.innerHTML = data.recommendations
    .map((movie) => {
      const posterUrl = movie.poster && movie.poster !== 'N/A' ? movie.poster : '';
      const year = movie.year || '';
      const runtime = movie.runtime || '';
      const yearRuntime = [year, runtime].filter(Boolean).join(' · ');
      const rating = movie.imdb_rating || (movie.rating ? movie.rating.toFixed(1) : '');

      return `
      <article class="movie-card" data-title="${escapeHtml(movie.title)}">
        <div class="poster-container">
          ${
            posterUrl
              ? `<img class="poster-image" src="${escapeHtml(posterUrl)}" alt="${escapeHtml(movie.title)}" loading="lazy" onerror="this.parentElement.innerHTML = getFallbackPosterHtml('${escapeHtml(movie.title)}');" />`
              : getFallbackPosterHtml(movie.title)
          }
          <div class="poster-overlay"></div>
          <div class="card-badges">
            <span class="match-badge">${movie.similarity}% Match</span>
            ${rating ? `<span class="rating-badge">★ ${escapeHtml(rating)}</span>` : ''}
          </div>
        </div>

        <div class="card-body">
          <div class="card-title-row">
            <h3 class="card-title">${escapeHtml(movie.title)}</h3>
            ${yearRuntime ? `<span class="card-year-runtime">${escapeHtml(yearRuntime)}</span>` : ''}
          </div>

          <div class="genre-tags">
            ${(movie.genres || [])
              .slice(0, 3)
              .map((g) => `<span class="genre-tag">${escapeHtml(g)}</span>`)
              .join('')}
          </div>

          <p class="card-overview">${escapeHtml(movie.plot || movie.overview || 'A film selected for its matching narrative structure and atmospheric themes.')}</p>

          <div class="card-actions">
            <button class="action-btn-primary find-similar-btn" data-title="${escapeHtml(movie.title)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              Find Similar
            </button>
            <button class="action-btn-secondary view-details-btn" data-title="${escapeHtml(movie.title)}">
              Details
            </button>
          </div>
        </div>
      </article>
    `;
    })
    .join('');

  // Attach card button handlers
  movieGrid.querySelectorAll('.find-similar-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const title = btn.dataset.title;
      movieInput.value = title;
      clearSearchBtn.hidden = false;
      submitSearch(title);
    });
  });

  movieGrid.querySelectorAll('.view-details-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      openMovieDetails(btn.dataset.title);
    });
  });
}

/**
 * Fallback SVG poster when no poster image is provided or loading fails
 */
function getFallbackPosterHtml(title) {
  return `
    <div class="poster-fallback">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
        <line x1="7" y1="2" x2="7" y2="22"></line>
        <line x1="17" y1="2" x2="17" y2="22"></line>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <line x1="2" y1="7" x2="7" y2="7"></line>
        <line x1="2" y1="17" x2="7" y2="17"></line>
        <line x1="17" y1="17" x2="22" y2="17"></line>
        <line x1="17" y1="7" x2="22" y2="7"></line>
      </svg>
      <span>${escapeHtml(title)}</span>
    </div>
  `;
}

/**
 * Open interactive movie detail modal
 */
async function openMovieDetails(title) {
  modalContent.innerHTML = `
    <div style="padding: 40px; text-align: center;">
      <p style="color: var(--c-forest); font-weight: 700;">Loading metadata for ${escapeHtml(title)}...</p>
    </div>
  `;
  movieModal.hidden = false;
  document.body.style.overflow = 'hidden';

  try {
    const res = await fetch(`/api/movie/${encodeURIComponent(title)}`);
    if (!res.ok) throw new Error('Could not fetch details.');
    const movie = await res.json();

    const posterUrl = movie.poster && movie.poster !== 'N/A' ? movie.poster : '';
    const imdbLink = movie.imdb_id ? `https://www.imdb.com/title/${movie.imdb_id}/` : null;

    modalContent.innerHTML = `
      <div class="modal-layout">
        <div class="modal-poster-wrap">
          ${
            posterUrl
              ? `<img class="modal-poster-img" src="${escapeHtml(posterUrl)}" alt="${escapeHtml(movie.title)}" />`
              : getFallbackPosterHtml(movie.title)
          }
        </div>
        <div class="modal-info">
          <h2 class="modal-title">${escapeHtml(movie.title)}</h2>
          
          <div class="modal-pills">
            ${movie.year ? `<span class="modal-pill">${escapeHtml(movie.year)}</span>` : ''}
            ${movie.rated ? `<span class="modal-pill">${escapeHtml(movie.rated)}</span>` : ''}
            ${movie.runtime ? `<span class="modal-pill">${escapeHtml(movie.runtime)}</span>` : ''}
            ${movie.imdb_rating ? `<span class="modal-pill rating">★ ${escapeHtml(movie.imdb_rating)} IMDb</span>` : ''}
            ${movie.rotten_tomatoes ? `<span class="modal-pill rating">🍅 ${escapeHtml(movie.rotten_tomatoes)}</span>` : ''}
          </div>

          <p class="modal-synopsis">${escapeHtml(movie.plot || movie.overview || 'No synopsis available.')}</p>

          <div class="modal-meta-table">
            ${
              movie.director
                ? `<div class="meta-row"><span class="meta-label">Director</span><span class="meta-value">${escapeHtml(movie.director)}</span></div>`
                : ''
            }
            ${
              movie.actors
                ? `<div class="meta-row"><span class="meta-label">Cast</span><span class="meta-value">${escapeHtml(movie.actors)}</span></div>`
                : ''
            }
            ${
              movie.genres && movie.genres.length
                ? `<div class="meta-row"><span class="meta-label">Genres</span><span class="meta-value">${escapeHtml(movie.genres.join(', '))}</span></div>`
                : ''
            }
            ${
              movie.awards && movie.awards !== 'N/A'
                ? `<div class="meta-row"><span class="meta-label">Awards</span><span class="meta-value">${escapeHtml(movie.awards)}</span></div>`
                : ''
            }
            ${
              movie.box_office && movie.box_office !== 'N/A'
                ? `<div class="meta-row"><span class="meta-label">Box Office</span><span class="meta-value">${escapeHtml(movie.box_office)}</span></div>`
                : ''
            }
          </div>

          <div class="modal-actions">
            <button class="action-btn-primary" id="modal-recommend-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              Recommend Similar
            </button>
            ${
              imdbLink
                ? `<a href="${imdbLink}" target="_blank" rel="noopener noreferrer" class="btn-imdb">View on IMDb ↗</a>`
                : ''
            }
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-recommend-btn').addEventListener('click', () => {
      closeModal();
      movieInput.value = movie.title;
      clearSearchBtn.hidden = false;
      submitSearch(movie.title);
    });
  } catch (err) {
    modalContent.innerHTML = `<div style="padding: 30px;"><p style="color: red;">${escapeHtml(err.message)}</p></div>`;
  }
}

function closeModal() {
  movieModal.hidden = true;
  document.body.style.overflow = '';
}

/**
 * Toast notifications
 */
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>🍿</span> <span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/**
 * Utility to escape HTML to prevent XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
