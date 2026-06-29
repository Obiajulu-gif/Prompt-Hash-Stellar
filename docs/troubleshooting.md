# Developer FAQ and Troubleshooting Guide

## Table of Contents
- [Common Errors](#common-errors)
- [Wallet Issues](#wallet-issues)
- [Transaction Problems](#transaction-problems)
- [Access and Unlock Issues](#access-and-unlock-issues)
- [Browser Cache and State](#browser-cache-and-state)
- [Debugging Tips](#debugging-tips)
- [FAQ](#faq)

---

## Common Errors

### Insufficient XLM for Fee

**Error Message:**
```
"InsufficientBalance" or "Insufficient balance in account"
```

**Causes:**
- Your Stellar wallet doesn't have enough XLM to cover the transaction fee
- You're trying to purchase a prompt but don't have enough XLM for both the purchase and the network fee
- Network fees have increased (rare, but possible)
- Account requires minimum XLM reserve balance

**Solutions:**

1. **Check Your Current Balance:**
   - Open Freighter wallet extension
   - Look at your XLM balance on the main dashboard
   - Ensure you have at least: `prompt_price + 0.01 XLM` (for network fees)

2. **Fund Your Account:**
   - Go to a Stellar faucet (e.g., Stellar Development Foundation testnet faucet for testnet work)
   - For mainnet, purchase XLM from an exchange (Coinbase, Kraken, etc.)
   - Wait for the transaction to confirm (usually 5-10 seconds)

3. **Check for Minimum Reserve:**
   - Stellar accounts require a minimum balance: 1 XLM for base + additional XLM per subentries
   - The PromptHash contract may hold some XLM for operational balances
   - Keep at least 2-3 XLM free to avoid hitting this limit

4. **Verify Network Conditions:**
   - Check [Stellar Dashboard](https://stellar.expert) for current network status
   - Network fees are minimal (typically 100 stroops = 0.00001 XLM)
   - Transactions may queue if network is congested (rare)

5. **Try These Steps:**
   ```
   a) Clear wallet cache and reconnect
   b) Refresh the browser and try again
   c) Wait 30 seconds and retry (may be transient)
   d) Ensure your wallet is connected to the correct network (testnet vs mainnet)
   ```

**Still experiencing issues?** See the [Debugging Tips](#debugging-tips) section below.

---

### Signature Verification Failed

**Error Message:**
```
"Signature verification failed" or "Invalid wallet signature"
```

**Causes:**
- The wallet signature on the unlock request doesn't match what the server expects
- The challenge token has expired (challenge tokens are only valid for 5 minutes)
- The signed message was altered between signature and verification
- Browser wallet connection was interrupted
- Nonce mismatch between client and server

**Solutions:**

1. **Check Challenge Token Expiration:**
   - Challenge tokens are short-lived (5 minutes maximum)
   - If too much time passed between requesting the challenge and signing, the token expired
   - **Solution:** Request a fresh challenge token and complete the unlock quickly

2. **Verify Wallet Connection:**
   - Open Freighter wallet
   - Ensure you're connected to PromptHash Stellar
   - Verify the connected wallet address matches the one that purchased the prompt
   - If disconnected, reconnect and try again

3. **Check Browser Wallet State:**
   - Close and reopen the Freighter extension
   - Refresh the PromptHash page
   - Reconnect your wallet
   - Try the unlock process again

4. **Signing Message Integrity:**
   - Ensure nothing interrupts the signing flow
   - Don't modify the challenge message in your wallet before signing
   - Look for a message like: `"Sign this challenge to unlock: [UUID]"`
   - **Don't edit it** - sign the exact message as presented

5. **Network Connectivity:**
   - Ensure your internet connection is stable
   - Try with a wired connection if on WiFi
   - Disable VPN/proxy if using one (may interfere with wallet communication)

6. **Clear Wallet and Browser Cache:**
   - See [Browser Cache and State](#browser-cache-and-state) section
   - Restart browser completely
   - Reconnect wallet fresh

**Debugging the Error:**
- Open browser console (F12 → Console tab)
- Look for error messages about signature verification
- Copy any error details and share in troubleshooting discussions

---

## Wallet Issues

### Wallet Won't Connect

**Problem:** Freighter or other wallet extension won't connect to PromptHash Stellar.

**Solutions:**
1. Install Freighter: https://www.freighter.app/
2. Ensure you're on a Stellar-compatible browser (Chrome, Firefox, Brave)
3. Grant PromptHash permission to access your wallet:
   - Look for permission popup when connecting
   - Click "Approve" or "Connect"
4. Check wallet is connected to the correct network (testnet/mainnet)
5. Try connecting from an incognito/private window
6. Restart browser completely

### Wallet Shows Different Address Than Expected

**Problem:** The address shown in PromptHash doesn't match your Freighter wallet.

**Solutions:**
1. Ensure only one Freighter wallet is installed/enabled
2. Check you're not using multiple browser profiles with different wallets
3. Verify the address in Freighter matches what PromptHash displays
4. Disconnect and reconnect the wallet
5. Click your wallet address in PromptHash to verify it's correct

---

## Transaction Problems

### Transaction Pending for Too Long

**Problem:** Your purchase transaction is stuck in "pending" state for more than a minute.

**Solutions:**
1. **Check Transaction Status:**
   - Wait up to 1-2 minutes (Stellar consensus is typically 3-5 seconds)
   - Refresh the page to see updated status
   - Check [Stellar Expert](https://stellar.expert) with your wallet address

2. **Network Congestion:**
   - If too many transactions are queuing, your transaction may be delayed
   - This is rare but possible during network stress
   - Your transaction will eventually confirm

3. **Cancel and Retry:**
   - After 3+ minutes, you can safely retry the transaction
   - The previous one will fail or eventually confirm
   - You'll only be charged if the transaction actually succeeded

4. **Check Account Status:**
   - Verify your account still has sufficient XLM
   - Ensure you're not at the minimum reserve limit

---

## Access and Unlock Issues

### "Has No Access" Error When Unlocking

**Error Message:**
```
"This wallet has not purchased access to this prompt" or similar
```

**Causes:**
- Your wallet hasn't purchased this prompt
- You purchased with a different wallet address
- The purchase transaction didn't finalize on-chain
- Contract hasn't indexed your purchase yet

**Solutions:**

1. **Verify Wallet Address:**
   - Check connected wallet in PromptHash
   - Go to your purchase history
   - Verify the purchase was made with THIS wallet
   - If purchased with different wallet, switch to that one

2. **Wait for Contract Indexing:**
   - After purchase, wait 10-30 seconds for the contract to process
   - Refresh the page
   - Try unlock again

3. **Check Purchase Receipt:**
   - Go to Profile → My Purchases
   - Verify the prompt appears in your list
   - If not listed, the purchase didn't complete

4. **Contact Support:**
   - If you're certain you purchased but can't access, collect:
     - Wallet address
     - Prompt ID
     - Transaction hash (from Stellar Expert)
     - Screenshot of error

---

### Unlock Button is Disabled

**Problem:** The unlock button is greyed out or won't respond to clicks.

**Solutions:**
1. Ensure wallet is connected (check connection status in top-right)
2. Reload the page (browser may be in corrupted state)
3. Verify you have a valid wallet connected
4. Clear browser cache (see section below)
5. Try in a different browser
6. Check console for errors (F12 → Console)

---

## Browser Cache and State

### Clearing Browser Cache for PromptHash

**Why Clear Cache?**
- Old wallet connections can cause conflicts
- Outdated contract state can cause incorrect behavior
- UI state can become corrupted

**Steps to Clear Cache (Chrome):**
1. Press `Ctrl+Shift+Delete` (or `Cmd+Shift+Delete` on Mac)
2. Select "All time" for time range
3. Check: Cookies, Cached images/files
4. Uncheck: Passwords (optional - keeps login info)
5. Click "Clear data"
6. Refresh PromptHash page

**Steps to Clear Cache (Firefox):**
1. Press `Ctrl+Shift+Delete` (or `Cmd+Shift+Delete` on Mac)
2. Click "Clear All"
3. Or: Menu → Settings → Privacy → Clear Recent History

**Clearing Freighter Wallet State:**
1. Open Freighter extension
2. Click Settings (gear icon)
3. Look for "Clear Cache" or "Reset" option
4. Click to clear
5. Log back in

---

## Debugging Tips

### Using Browser Developer Console

**Opening Console:**
- Windows/Linux: Press `F12` or `Ctrl+Shift+J`
- Mac: Press `Cmd+Option+J`
- Then click the "Console" tab

**Common Errors to Look For:**
- `CORS error` - cross-origin request blocked
- `Network error` - server unreachable
- `TypeError` - code execution problem
- `SyntaxError` - code parsing issue

**Capturing Error Information:**
```
1. Reproduce the error
2. Take screenshot of console
3. Look for red error messages
4. Copy the full error text
5. Share in support channel with steps to reproduce
```

### Network Tab Debugging

**To see network requests:**
1. Open Developer Tools (F12)
2. Click "Network" tab
3. Reproduce the error
4. Look for failed requests (red text)
5. Click on failed request to see details

**What to look for:**
- Status code: 200 (good), 4xx (client error), 5xx (server error)
- Response: Check the server's error message
- Headers: Verify correct endpoints

### Checking Stellar Contract State

**Using Stellar Expert:**
1. Go to https://stellar.expert
2. Search for the PromptHash contract address
3. View: Balances, Transactions, State
4. Verify your wallet shows in purchase records

---

## FAQ

### Q: How long does a purchase take to finalize?

**A:** Stellar transactions finalize in 3-5 seconds. The contract updates immediately. However:
- UI refresh may take 10-30 seconds for indexer to catch up
- Always wait and refresh before reporting issues

### Q: Can I return a purchased prompt?

**A:** Check with the platform terms. Purchases are typically final, as access is verified on-chain. Disputes should be escalated to platform support.

### Q: What if I lost access to my wallet?

**A:** Your purchase rights are tied to your wallet address on the blockchain. If you lose wallet access:
- Purchase rights are permanently tied to that address
- You'll need that same wallet/account to unlock prompts
- Recovery depends on your wallet backup/recovery phrase

### Q: Is PromptHash available on mainnet or testnet?

**A:** Check the platform documentation. Most development/testing is on testnet. Mainnet access should be announced officially.

### Q: Can I use multiple wallets?

**A:** Yes, but each wallet is independent:
- Purchases are per wallet
- Each wallet sees only its own purchases
- You can freely switch wallets

### Q: How do I report a security issue?

**A:** See [SECURITY.md](../SECURITY.md) in the repository root for responsible disclosure guidelines.

---

## Still Need Help?

1. **Check the Docs:** [docs/overview.md](./overview.md), [docs/architecture.md](./architecture.md)
2. **GitHub Issues:** Search existing issues for similar problems
3. **Create an Issue:** Provide Stellar transaction hash, wallet address, and exact error message
4. **Security Concerns:** Follow [SECURITY.md](../SECURITY.md) for responsible disclosure
