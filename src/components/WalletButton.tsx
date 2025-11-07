import { useState } from "react";
import { Button, Text, Modal, Profile } from "@stellar/design-system";
import { useWallet } from "../hooks/useWallet";
import { useWalletBalance } from "../hooks/useWalletBalance";
import { connectWallet, disconnectWallet } from "../util/wallet";

export const WalletButton = () => {
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const { address, isPending } = useWallet();
  const { xlm, ...balance } = useWalletBalance();
  const buttonLabel = isPending ? "Loading..." : "Connect";

  if (!address) {
    return (
      <Button variant="primary" size="md" onClick={() => void connectWallet()} className="text-white px-2">
        {buttonLabel}
      </Button>
    );
  }

  return (
    <div
      className="flex flex-col"
    >
      <Profile
        publicAddress={address}
        size="md"
        isShort
        onClick={() => setShowDisconnectModal((prev) => !prev)}
      />

      {showDisconnectModal && (
        <div className="absolute mt-10 w-44 bg-[#070602] rounded-lg shadow-lg">
            <div>
              {/* <div>
                Connected as{" "}
                <code style={{ lineBreak: "anywhere" }}>{shortenAddress(address)}</code>. 
                <p>
                  Do you want to disconnect?
                </p>
              </div> */}

              <Button
                size="md"
                variant="primary"
                onClick={() => {
                  void disconnectWallet().then(() =>
                    setShowDisconnectModal(false),
                  );
                }}
                className="w-full mx-auto p-2"
              >
                Disconnect
              </Button>
            </div>
        </div>
      )}
    </div>
  );
};
