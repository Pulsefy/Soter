"""
Quick test script to verify the AI service setup
Run this after installing dependencies to test the basic functionality
"""

import sys
import subprocess


def test_imports():
    """Test if all required packages can be imported"""
    print("Testing imports...")
    
    try:
        import fastapi
        print(f"✓ FastAPI {fastapi.__version__}")
    except ImportError as e:
        print(f"✗ FastAPI not installed: {e}")
        return False
    
    try:
        import uvicorn
        print(f"✓ Uvicorn available")
    except ImportError as e:
        print(f"✗ Uvicorn not installed: {e}")
        return False
    
    try:
        import pydantic
        print(f"✓ Pydantic {pydantic.__version__}")
    except ImportError as e:
        print(f"✗ Pydantic not installed: {e}")
        return False
    
    try:
        from pydantic_settings import BaseSettings
        print(f"✓ Pydantic Settings available")
    except ImportError as e:
        print(f"✗ Pydantic Settings not installed: {e}")
        return False
    
    try:
        from dotenv import load_dotenv
        print(f"✓ python-dotenv available")
    except ImportError as e:
        print(f"✗ python-dotenv not installed: {e}")
        return False
    
    return True


def test_config():
    """Test if configuration loads properly"""
    print("\nTesting configuration...")
    
    try:
        from config import settings, get_settings
        print(f"✓ Configuration loaded successfully")
        print(f"  - Environment: {settings.app_env}")
        print(f"  - Log Level: {settings.log_level}")
        print(f"  - Port: {settings.port}")
        
        api_valid = settings.validate_api_keys()
        provider = settings.get_active_provider()
        
        if provider:
            print(f"  ✓ AI Provider configured: {provider}")
        else:
            print(f"  ⚠ No API keys configured (AI features unavailable)")
        
        return True
    except Exception as e:
        print(f"✗ Configuration error: {e}")
        return False


def test_app():
    """Test if the FastAPI app can be instantiated"""
    print("\nTesting application...")
    
    try:
        from main import app
        print(f"✓ FastAPI app created: {app.title}")
        print(f"  - Version: {app.version}")
        print(f"  - Routes: {len(app.routes)}")
        
        # List routes
        for route in app.routes:
            if hasattr(route, 'path') and hasattr(route, 'methods'):
                methods = ', '.join(route.methods) if route.methods else 'ANY'
                print(f"    {methods:8} {route.path}")
        
        return True
    except Exception as e:
        print(f"✗ Application error: {e}")
        return False


def main():
    """Run all tests"""
    print("=" * 60)
    print("Soter AI Service - Setup Verification")
    print("=" * 60)
    
    results = []
    
    # Test 1: Imports
    results.append(("Imports", test_imports()))
    
    # Test 2: Configuration
    results.append(("Configuration", test_config()))
    
    # Test 3: Application
    results.append(("Application", test_app()))
    
    # Summary
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n✓ All tests passed! The AI service is ready.")
        print("\nTo start the server:")
        print("  python main.py")
        print("  or")
        print("  uvicorn main:app --reload")
        return 0
    else:
        print("\n✗ Some tests failed. Please check the errors above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
