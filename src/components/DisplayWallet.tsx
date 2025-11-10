import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import {
  LogOut,
  // Loader2,
  Wallet,
  Copy,
  ExternalLink,
  AlertCircle,
  X,
} from "lucide-react";
import {
  // useEffect,
  useState,
} from "react";
// import { useConnect, useDisconnect } from "@starknet-react/core";
// import { ConnectWallet } from "./connect-wallet";
import ConnectAccount from "./ConnectAccount";

declare global {
  interface Window {
    ethereum?: any;
  }
}

const DisplayWallet = () => {
  const [isConnected, _setIsConnected] = useState(false);
  const [account, _setAccount] = useState<string | null>(null);
  // const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // const isConnectingRef = useRef(false);

  // const { connect: starknetConnect, connectors: starknetConnectors } = useConnect();
  // const { disconnect } = useDisconnect();

  // useEffect(() => {
  // 	const checkConnection = async () => {
  // 		if (window.ethereum) {
  // 			const accounts = await window.ethereum.request({
  // 				method: "eth_accounts",
  // 			});
  // 			if (accounts.length > 0) {
  // 				setAccount(accounts[0]);
  // 				setIsConnected(true);
  // 			}
  // 		}
  // 	};

  // 	checkConnection();

  // 	const handleAccountsChanged = (accounts: string[]) => {
  // 		if (accounts.length > 0) {
  // 			setAccount(accounts[0]);
  // 			setIsConnected(true);
  // 		} else {
  // 			setAccount(null);
  // 			setIsConnected(false);
  // 		}
  // 	};

  // 	if (window.ethereum) {
  // 		window.ethereum.on("accountsChanged", handleAccountsChanged);
  // 	}

  // 	return () => {
  // 		if (window.ethereum) {
  // 			window.ethereum.removeListener(
  // 				"accountsChanged",
  // 				handleAccountsChanged
  // 			);
  // 		}
  // 	};
  // }, []);

  // const connect = async () => {
  // 	console.log("connect() called");

  // 	if (!window.ethereum) {
  // 		console.warn("MetaMask not detected");
  // 		setError("MetaMask not installed");
  // 		return;
  // 	}

  // 	if (isConnectingRef.current || isLoading) {
  // 		console.warn("Connection already in progress");
  // 		return;
  // 	}

  // 	isConnectingRef.current = true;
  // 	setIsLoading(true);
  // 	setError(null);

  // 	try {
  // 		console.log("Requesting accounts...");
  // 		const accounts = await window.ethereum.request({
  // 			method: "eth_requestAccounts",
  // 		});
  // 		console.log("Accounts received:", accounts);

  // 		// Add network or switch
  // 		try {
  // 			await window.ethereum.request({
  // 				method: "wallet_addEthereumChain",
  // 				params: [
  // 					{
  // 						chainId: "0x534e5f474f45524c49", // Starknet Goerli testnet
  // 						chainName: "Starknet Testnet",
  // 						nativeCurrency: {
  // 							name: "STRK",
  // 							symbol: "STRK",
  // 							decimals: 18,
  // 						},
  // 						rpcUrls: ["https://starknet-testnet.public.blastapi.io"],
  // 						blockExplorerUrls: ["https://testnet.starkscan.co"],
  // 					},
  // 				],
  // 			});
  // 			console.log("Network added or already exists");
  // 		} catch (networkError) {
  // 			console.warn("Error adding network", networkError);
  // 		}

  // 		setAccount(accounts[0]);
  // 		setIsConnected(true);
  // 		await registerUser(accounts[0]);
  // 	} catch (err: any) {
  // 		console.error("Connection failed:", err);
  // 		setError(err.message || "Failed to connect wallet");
  // 		setIsConnected(false);
  // 		setAccount(null);
  // 	} finally {
  // 		setIsLoading(false);
  // 		isConnectingRef.current = false;
  // 		console.log("connect() finished");
  // 	}
  // };

  // const registerUser = async (address: string) => {
  // 	try {
  // 		const response = await fetch("/api/user", {
  // 			method: "POST",
  // 			headers: {
  // 				"Content-Type": "application/json",
  // 			},
  // 			body: JSON.stringify({ walletAddress: address }),
  // 		});

  // 		if (!response.ok) {
  // 			const data = await response.json();
  // 			throw new Error(data.error || "Failed to register user");
  // 		}
  // 	} catch (apiError: any) {
  // 		console.error("API Error:", apiError);
  // 	}
  // };

  // const disconnect = () => {
  // 	setAccount(null);
  // 	setIsConnected(false);
  // };

  const formatAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(
      address.length - 4,
    )}`;
  };

  const copyAddress = () => {
    if (account) {
      navigator.clipboard.writeText(account);
    }
  };

  const viewInExplorer = () => {
    if (account) {
      window.open(`https://testnet.starkscan.co/contract/${account}`, "_blank");
    }
  };

  return (
    <div>
      {isConnected && account ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="ml-auto font-bold border-purple-900 text-purple-900 hover:text-purple-300 hover:border-purple-800"
            >
              <Wallet className="md:mr-2 h-4 w-4" />
              <span className="hidden lg:inline">{formatAddress(account)}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 bg-gray-900 text-white border-gray-800">
            <DropdownMenuLabel className="flex items-center">
              <span className="md:hidden font-mono text-purple-400">
                {formatAddress(account)}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-gray-800" />
            <DropdownMenuItem
              onClick={copyAddress}
              className="flex cursor-pointer items-center hover:bg-gray-800"
            >
              <Copy className="mr-2 h-4 w-4" />
              <span>Copy Address</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={viewInExplorer}
              className="flex cursor-pointer items-center hover:bg-gray-800"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              <span>View in Explorer</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-gray-800" />
            <DropdownMenuItem
              onClick={() => {
                // disconnect()
              }}
              className="flex cursor-pointer items-center text-red-400 hover:bg-gray-800 hover:text-red-300"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Disconnect</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        // <Button
        // 	variant="outline"
        // 	className="ml-auto font-bold border-purple-900 text-purple-800 hover:text-purple-300 hover:border-purple-800"
        // 	onClick={connect}
        // 	disabled={isLoading}
        // >
        // 	{isLoading ? (
        // 		<Loader2 className="mr-2 h-4 w-4 animate-spin" />
        // 	) : (
        // 		<Wallet className="md:mr-2 h-4 w-4" />
        // 	)}
        // 	<span className="hidden md:inline">
        // 		{isLoading ? "Connecting..." : "Connect Wallet 2"}
        // 	</span>
        // </Button>
        // <ConnectWallet />
        <ConnectAccount />
      )}
      {error && (
        <div className="container py-2">
          <div className="bg-red-900/60 text-red-200 text-sm px-4 py-2 rounded-md flex justify-between items-center">
            <div className="flex items-center">
              <AlertCircle className="h-4 w-4 mr-2" />
              {error}
            </div>
            <button
              title="Close"
              onClick={() => setError(null)}
              className="text-red-200 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DisplayWallet;
