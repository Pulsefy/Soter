# Contributing to Soter Mobile

Thank you for contributing to the mobile module! This guide will help you set up your development environment and understand our workflow.

## Quick Start

If you're new to the project, follow these steps to get started:

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Update the variables as described in the Environment Configuration section below.

3. **Run the development server**:
   ```bash
   pnpm start
   ```

## Development Workflow

### Running Tests

Before submitting changes, always run the test suite:

```bash
pnpm test
```

This runs Jest tests for your React Native components and utilities. Tests are located in files with `.test.ts` or `.test.tsx` extensions.

### Running Linting

Ensure your code follows our coding standards:

```bash
pnpm lint
```

This runs ESLint with the Expo configuration. Fix any linting errors before creating a pull request.

### Starting the Development Server

Launch the Expo development server:

```bash
pnpm start
```

**Expo Usage Notes:**
- The server will start on `http://localhost:8081` by default
- Use the Expo Go app on your physical device to scan the QR code
- For Android Emulator: Press `a` in the terminal
- For iOS Simulator: Press `i` in the terminal
- Use `--clear` flag to clear Metro cache if needed: `expo start --clear`

### Platform-specific Commands

- **Android**: `pnpm android` - Starts and runs on Android emulator/device
- **iOS**: `pnpm ios` - Starts and runs on iOS simulator/device  
- **Web**: `pnpm web` - Runs in web browser for testing

## Environment Configuration

The mobile app uses Expo's environment variable system with the `EXPO_PUBLIC_` prefix. Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

### Required Environment Variables

```bash
# The base URL for the backend API
# For local development with a physical device, use your machine's IP (e.g., http://192.168.1.5:3000)
# For Android Emulator, use http://10.0.2.2:3000
# For iOS Simulator, use http://localhost:3000
EXPO_PUBLIC_API_URL=http://localhost:3000

# Network configuration
EXPO_PUBLIC_NETWORK=testnet
```

### Finding Your Local IP (for Physical Device Testing)

**Windows:**
```bash
ipconfig
```
Look for the "IPv4 Address" under your active network adapter.

**macOS/Linux:**
```bash
ifconfig | grep "inet "
```
Look for the IP address (usually starts with 192.168.x.x or 10.x.x.x).

## Branching & Workflow

- Create feature branches from `main` or the current feature branch
- Use descriptive names: `feature/mobile-auth` or `fix/navigation-header`
- Keep branches focused on single features or fixes

## Commit Style

We follow conventional commits:
- `feat(mobile): ...` - New features
- `fix(mobile): ...` - Bug fixes
- `docs(mobile): ...` - Documentation changes
- `test(mobile): ...` - Test additions/changes
- `refactor(mobile): ...` - Code refactoring

## Troubleshooting

### Metro Bundler Issues

**Problem**: Metro bundler fails to start or hangs
**Solutions**:
```bash
# Clear Metro cache
expo start --clear

# Reset node modules (last resort)
rm -rf node_modules
pnpm install
```

**Problem**: Bundle errors with module resolution
**Solutions**:
- Check that all imports use correct file extensions
- Ensure `package.json` has all required dependencies
- Restart the Metro bundler with `--clear`

### Connectivity Issues to Backend

**Problem**: Connection refused when running on physical device
**Solutions**:
1. Ensure your backend server is running and accessible
2. Update `EXPO_PUBLIC_API_URL` to use your machine's local IP address
3. Check that your firewall allows connections on the backend port
4. Verify your device and development machine are on the same network

**Problem**: API calls fail from Android Emulator
**Solutions**:
- Use `http://10.0.2.2:3000` instead of `localhost:3000` in `EXPO_PUBLIC_API_URL`
- Ensure the backend is running on port 3000
- Check Android emulator network settings

**Problem**: API calls fail from iOS Simulator
**Solutions**:
- Use `http://localhost:3000` in `EXPO_PUBLIC_API_URL`
- Ensure the backend is running on port 3000
- Check that no other services are blocking port 3000

### Common Development Issues

**Problem**: Hot reloading not working
**Solutions**:
- Shake device to open developer menu and select "Reload"
- Press `r` in the Metro terminal
- Ensure your file changes are saved

**Problem**: App crashes on startup
**Solutions**:
- Check the Metro terminal for error messages
- Verify all environment variables are properly set
- Ensure all dependencies are installed correctly

## PR Checklist

Before submitting a pull request, ensure:

- [ ] Branch is up to date with `main`
- [ ] All tests pass: `pnpm test`
- [ ] Linting passes: `pnpm lint`
- [ ] New features include tests
- [ ] No hardcoded API endpoints (use `.env`)
- [ ] Documentation updated if necessary
- [ ] Screenshots/videos included for UI changes
- [ ] Environment variables are documented if added
- [ ] Code follows the existing style patterns

## Getting Help

If you encounter issues not covered here:

1. Check the existing issues in the repository
2. Look at the Health Screen in the app for troubleshooting tips
3. Ask questions in the team communication channels
4. Review the main README.md for additional context
