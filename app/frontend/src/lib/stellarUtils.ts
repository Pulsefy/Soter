import { signTransaction as freighterSignTransaction } from "@stellar/freighter-api";

/**
 * Signs a base64 encoded XDR transaction using Freighter.
 * @param xdr - The base64 encoded transaction envelope XDR.
 * @param network - Target network, defaults to 'TESTNET'.
 * @returns The signed base64 encoded XDR.
 */
export async function signTransaction(xdr: string, networkPassphrase?: string): Promise<string> {
  try {
    const opts: { networkPassphrase?: string } = {};
    if (networkPassphrase) {
      opts.networkPassphrase = networkPassphrase;
    }
    const signedTx = await freighterSignTransaction(xdr, opts) as Record<string, unknown>;
    
    if (signedTx.error && typeof signedTx.error === "string") {
       throw new Error(signedTx.error);
    }
    
    // Depending on Freighter version, it might return a string directly or an object.
    return (signedTx.signedTxXdr || signedTx) as string;
  } catch (error: unknown) {
    console.error("Error signing transaction with Freighter:", error);
    
    // Attempt to handle known Freighter UI rejection strings gracefully
    if (typeof error === "string" && error.includes("User declined")) {
      throw new Error("User Rejected");
    }
    
    if (error && typeof error === "object" && "message" in error) {
      const errObj = error as Record<string, unknown>;
      const msg = String(errObj.message);
      if (
        msg.includes("User declined") || 
        msg.includes("User rejected")
      ) {
        throw new Error("User Rejected");
      }
      if (
        msg.includes("Insufficient Balance") || 
        msg.includes("balance") || 
        msg.includes("underfunded")
      ) {
        throw new Error("Insufficient Balance");
      }
    }
    
    throw error;
  }
}
