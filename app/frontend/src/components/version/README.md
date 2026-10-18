# Version Management Features

## Overview
This feature implements two version-related features for Soter:
1. **Release Notes Modal**: Shows when a new version is available
2. **Force Upgrade Screen**: Blocks app usage when force upgrade is required

## Architecture

### Data Flow
```
VersionProvider (App wrapper)
├── useVersion (Custom hook)
├── VersionStore (Zustand + localStorage)
├── VersionService (Mock/API service)
│
├── ForceUpgradeScreen (Blocks app)
└── ReleaseNotesModal (Shows changes)
```

### Priority Order
1. Force Upgrade takes priority over Release Notes
2. If `forceUpgrade == true`, block app immediately
3. Else show Release Notes for new versions

## Components

### VersionStore (`/lib/versionStore.ts`)
- Zustand store with localStorage persistence
- Tracks `lastSeenVersion`, `shouldShowReleaseNotes`, `forceUpgradeRequired`
- Contains mock data for MVP implementation

### useVersion (`/hooks/useVersion.ts`)
- Custom hook for version logic
- Handles loading, state management, and user interactions
- Exposes `shouldBlockApp`, `shouldShowNotes`, `releaseNotes`, etc.

### VersionProvider (`/components/VersionProvider.tsx`)
- Wraps the entire app in layout
- Handles startup version check logic
- Manages modal/upgrade screen visibility

### ReleaseNotesModal (`/components/ReleaseNotesModal.tsx`)
- Clean, centered modal using Radix UI Dialog
- Shows version, title, and list of changes
- "Continue" button stores viewed version locally

### ForceUpgradeScreen (`/components/ForceUpgradeScreen.tsx`)
- Full-screen upgrade required page
- Blocks access to dashboard, beneficiaries, vouchers, etc.
- "Update App" button (MVP logs to console)

## Storage Strategy
- Uses Zustand's `persist` middleware with `localStorage`
- Stores only `lastSeenVersion` for privacy
- Storage key: `version-storage`

## Mock Data Structure
```typescript
{
  currentVersion: "1.4.0",
  latestVersion: "1.5.0",
  forceUpgrade: false,
  releaseNotes: {
    version: "1.5.0",
    title: "What's New",
    changes: [
      "Improved beneficiary verification",
      "Faster voucher loading",
      "Offline sync improvements"
    ]
  }
}
```

## Future Backend Integration
The implementation is designed for easy backend integration:
1. Replace `VersionService.fetchVersionConfig()` with real API call
2. Update data structure to match backend schema
3. No UI component changes needed

## Test Coverage
- Version store initialization and persistence
- Release notes display logic
- Force upgrade priority
- Version comparison and storage

## Usage
```typescript
// In component
const {
  shouldBlockApp,
  shouldShowNotes,
  releaseNotes,
  handleContinue
} = useVersion();

// In layout (automatically added)
<VersionProvider>
  <YourApp />
</VersionProvider>
```