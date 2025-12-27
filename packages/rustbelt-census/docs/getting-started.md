# Getting Started: rustbelt-census (Windows)

This guide walks through cloning the repo from GitHub and installing/running the
`rustbelt-census` CLI on Windows.

## Prerequisites

- **Git** (for cloning the repo)
- **Python 3.11+** (required by `rustbelt-census`)
- **PowerShell** (examples below)

## 1) Clone the repo

Open PowerShell and run:

```powershell
git clone https://github.com/<org-or-user>/rustbelt.git
cd rustbelt
```

> Replace `<org-or-user>` with the actual GitHub organization or user that hosts
> the `rustbelt` repository.

## 2) Create and activate a virtual environment

From the repo root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If you see a PowerShell execution policy error, allow local scripts for the
current session:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Then re-run the activation command.

## 3) Install the CLI package

Install `rustbelt-census` in editable mode from the monorepo:

```powershell
python -m pip install --upgrade pip
python -m pip install -e .\packages\rustbelt-census
```

## 4) (Optional) Set a Census API key

The CLI looks for the API key in the `CENSUS_API_KEY` environment variable by
default. If you have a key, set it for your session:

```powershell
$env:CENSUS_API_KEY = "<your-key>"
```

## 5) Run the CLI

Verify the CLI is installed:

```powershell
rustbelt-census --help
```

Try a quick request:

```powershell
rustbelt-census affluence --zips 19103,19104
```

Or fetch a full state dataset:

```powershell
rustbelt-census affluence --state PA --out pa_zcta_affluence.csv
```

## Next steps

- For detailed CLI usage, see
  [Rustbelt Census CLI documentation](rustbelt-census-cli-documentation.md).
- For product/technical context, see:
  - [Functional spec](rb-census-functional-spec.md)
  - [Technical plan](rb-census-technical-plan.md)
