# Global Guidelines

## Python Environment

This machine uses **uv** (`~/.local/bin/uv`) for Python version management and virtual environments. Do NOT use system pip, pyenv, or conda.

- **Create venvs**: `uv venv` or `uv venv --python 3.13` to pin a version
- **Install deps**: `uv pip install -r requirements.txt`
- **Run scripts**: `uv run python script.py`
- **Installed Pythons**: 3.13.6, 3.12.3 (system), 3.11.13 — check with `uv python list --only-installed`
- **Install new Python**: `uv python install 3.x`

