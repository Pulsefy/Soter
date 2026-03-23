# AI Service CI/CD Workflow

This document describes the Continuous Integration and Continuous Deployment (CI/CD) workflow for the Soter AI Service.

## Overview

The AI service uses GitHub Actions to automate testing, building, and security scanning whenever code changes are pushed to the repository.

## Workflow Triggers

The CI/CD pipeline runs automatically when:
- Code is pushed to `main` or `develop` branches in the `app/ai-service/` directory
- A pull request is opened targeting the `main` branch with changes to the AI service

## Pipeline Stages

### 1. Lint Stage ✓
**Purpose**: Code quality and style checking

**Tools Used**:
- **flake8**: Checks for Python syntax errors and undefined names
- **black**: Code formatting verification
- **mypy**: Static type checking

**What it does**:
- Ensures code follows Python best practices
- Maintains consistent code formatting
- Catches type-related bugs early

### 2. Test Stage ✓
**Purpose**: Automated testing and coverage reporting

**Tools Used**:
- **pytest**: Testing framework
- **pytest-cov**: Coverage reporting
- **httpx**: Async HTTP client for testing

**What it does**:
- Runs all test cases in `test_main.py`
- Executes setup verification script (`test_setup.py`)
- Generates code coverage reports
- Uploads coverage data to Codecov (optional)

**Tests Include**:
- Root endpoint functionality
- Health check endpoint
- API documentation availability
- OpenAPI schema validation
- Error handling

### 3. Build Stage ✓
**Purpose**: Create deployment package

**What it does**:
- Installs all dependencies
- Verifies the application can start
- Creates a deployment ZIP package
- Uploads artifact for download (retained for 7 days)

### 4. Security Scan Stage ✓
**Purpose**: Security vulnerability assessment

**Tools Used**:
- **safety**: Checks Python dependencies for known vulnerabilities
- **bandit**: Security-focused static analysis

**What it does**:
- Scans `requirements.txt` for vulnerable packages
- Analyzes code for common security issues
- Provides security recommendations

## File Structure

```
.github/workflows/
└── ai-service-ci.yml    # Main CI/CD workflow configuration

app/ai-service/
├── main.py              # FastAPI application
├── config.py            # Configuration settings
├── requirements.txt     # Python dependencies
├── test_main.py         # Pytest test suite
├── test_setup.py        # Setup verification script
└── .env.example         # Environment variables template
```

## Running Locally

You can run the same checks locally before pushing:

### Install Development Dependencies
```bash
cd app/ai-service
pip install -r requirements.txt
pip install pytest pytest-cov flake8 black mypy safety bandit
```

### Run Linting
```bash
# Check syntax
flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics

# Check formatting
black --check .

# Type checking
mypy . --ignore-missing-imports
```

### Run Tests
```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=. --cov-report=html
```

### Security Scans
```bash
# Check dependencies
safety check -r requirements.txt

# Security lint
bandit -r . -ll
```

## Viewing Results

After pushing code:

1. Go to the GitHub repository
2. Click on "Actions" tab
3. Select the workflow run (e.g., "AI Service CI")
4. View detailed logs for each job

## Artifacts

The build stage creates a deployment artifact:
- **Name**: `ai-service-deploy.zip`
- **Contents**: Complete AI service ready for deployment
- **Retention**: Available for download for 7 days

## Troubleshooting

### Common Issues

**1. Lint Failures**
```bash
# Fix formatting automatically
black .

# Fix import issues
isort . --profile black
```

**2. Test Failures**
```bash
# Run specific test
pytest test_main.py::test_health_endpoint -v

# Run with output
pytest -s
```

**3. Dependency Issues**
```bash
# Upgrade pip
python -m pip install --upgrade pip

# Reinstall dependencies
pip install -r requirements.txt --force-reinstall
```

## Adding New Tests

To add new tests:

1. Create a new test function in `test_main.py`
2. Name it with `test_` prefix
3. Use the `client` fixture for HTTP requests
4. Add appropriate assertions

Example:
```python
def test_new_feature(client):
    """Test new feature"""
    response = client.get("/new-endpoint")
    assert response.status_code == 200
    assert response.json()["status"] == "success"
```

## Deployment

The CI/CD pipeline prepares the deployment package but doesn't automatically deploy. To deploy:

1. Download the `ai-service-deploy.zip` artifact from GitHub Actions
2. Extract to your server
3. Install dependencies: `pip install -r requirements.txt`
4. Set environment variables
5. Start the server: `uvicorn main:app --host 0.0.0.0 --port 8000`

## Environment Variables

Configure these in your deployment environment:

```bash
# Copy example file
cp .env.example .env

# Edit with your values
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
```

## Support

For issues or questions about the CI/CD workflow:
- Check the GitHub Actions logs
- Review error messages in the workflow output
- Consult the main README.md for general setup help
