/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import TestnetFaucetHelper from "../systems/TestnetFaucetHelper";

// Mock next-intl
jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      title: "Testnet Faucet Helper",
      subtitle: "Stellar / Soroban Development Tool",
      connectWallet: "Please connect your wallet in the navbar to view balance and request funds.",
      unfundedAccount: "Account not created yet (needs activation/funding)",
      lastUpdated: "Last updated: 12:00:00 PM",
      refresh: "Refresh Balance",
      requestFunds: "Request 10,000 XLM",
      requesting: "Requesting...",
      success: "Account successfully funded!",
      error: "Failed to fund account. Please try again.",
      instructionsTitle: "Step-by-Step Instructions",
      step1: "Connect your Freighter wallet",
      step2: "Click request funds",
      step3: "Verify balance",
      linksTitle: "Official Stellar Faucets",
      faucetNote: "Visible only in testnet environments."
    };
    return translations[key] || key;
  }
}));

// Mock wallet store state
let mockStore = {
  publicKey: null as string | null,
  network: "testnet" as string | null
};

jest.mock("../../lib/walletStore", () => ({
  useWalletStore: jest.fn(() => mockStore)
}));

// Mock env configuration
let mockStellarNetwork = "testnet";
jest.mock("../../lib/env", () => ({
  get stellarNetwork() {
    return mockStellarNetwork;
  }
}));

// Mock explorer
jest.mock("../../lib/explorer", () => ({
  buildExplorerUrl: jest.fn((type, id) => `https://stellar.expert/explorer/testnet/${type}/${id}`)
}));

describe("TestnetFaucetHelper", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = {
      publicKey: null,
      network: "testnet"
    };
    mockStellarNetwork = "testnet";
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("does not render when on mainnet", () => {
    mockStellarNetwork = "mainnet";
    mockStore.network = "mainnet";
    
    const { container } = render(<TestnetFaucetHelper />);
    expect(container.firstChild).toBeNull();
  });

  it("renders when on testnet", () => {
    render(<TestnetFaucetHelper />);
    expect(screen.getByText("Testnet Faucet Helper")).toBeInTheDocument();
  });

  it("shows connect wallet prompt when wallet is not connected", () => {
    render(<TestnetFaucetHelper />);
    expect(
      screen.getByText("Please connect your wallet in the navbar to view balance and request funds.")
    ).toBeInTheDocument();
  });

  it("fetches and displays balance when wallet is connected", async () => {
    mockStore.publicKey = "GBMXXY5...123456";
    
    // Mock Horizon account fetch returning balances
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({
        balances: [{ asset_type: "native", balance: "150.5000000" }]
      })
    });

    render(<TestnetFaucetHelper />);

    await waitFor(() => {
      expect(screen.getByText("150.50 XLM")).toBeInTheDocument();
    });
  });

  it("shows activation warning when account is unfunded (404 from Horizon)", async () => {
    mockStore.publicKey = "GBMXXY5...123456";
    
    // Mock Horizon account fetch returning 404
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      status: 404,
      ok: false
    });

    render(<TestnetFaucetHelper />);

    await waitFor(() => {
      expect(screen.getByText("Account not created yet (needs activation/funding)")).toBeInTheDocument();
    });
  });

  it("allows minimizing and expanding the helper drawer", () => {
    render(<TestnetFaucetHelper />);

    // Initially expanded
    expect(screen.getByText("Stellar / Soroban Development Tool")).toBeInTheDocument();

    // Click minimize (X button)
    const minimizeBtn = screen.getByLabelText("Minimize faucet helper");
    fireEvent.click(minimizeBtn);

    // Should collapse
    expect(screen.queryByText("Stellar / Soroban Development Tool")).not.toBeInTheDocument();

    // Should show floating button
    const expandBtn = screen.getByLabelText("Open Testnet Faucet Helper");
    expect(expandBtn).toBeInTheDocument();

    // Click expand button
    fireEvent.click(expandBtn);

    // Should expand again
    expect(screen.getByText("Stellar / Soroban Development Tool")).toBeInTheDocument();
  });

  it("requests funds via Friendbot on request button click", async () => {
    mockStore.publicKey = "GBMXXY5...123456";
    
    // Mock 1st Horizon fetch: 404 unfunded
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      status: 404,
      ok: false
    });

    render(<TestnetFaucetHelper />);

    await waitFor(() => {
      expect(screen.getByText("Account not created yet (needs activation/funding)")).toBeInTheDocument();
    });

    // Mock Friendbot API call: 200 OK
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ result: "success" })
    });

    // Mock 2nd Horizon fetch (refresh after fund): 200 OK with balance
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({
        balances: [{ asset_type: "native", balance: "10000.0000000" }]
      })
    });

    const fundBtn = screen.getByRole("button", { name: "Request 10,000 XLM" });
    fireEvent.click(fundBtn);

    // Verify it triggers loading state
    expect(screen.getByText("Requesting...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Account successfully funded!")).toBeInTheDocument();
      expect(screen.getByText("10,000.00 XLM")).toBeInTheDocument();
    });
  });
});
