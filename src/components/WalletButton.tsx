import { useState } from "react";
import { Button } from "@stellar/design-system";
import { useWallet } from "../hooks/useWallet";
// import { useWalletBalance } from "../hooks/useWalletBalance";
import { connectWallet, disconnectWallet } from "../util/wallet";
import { shortenAddress } from "@/lib/utils";
import { Button as ShadcnButton } from "./ui/button";

export const WalletButton = () => {
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const { address, isPending } = useWallet();
  // const {
  //   // xlm,
  //   // ...balance
  // } = useWalletBalance();
  const buttonLabel = isPending ? "Loading..." : "Connect";

  if (!address) {
    return (
      <ShadcnButton
        variant={"default"} size={"sm"}
        className="ml-auto font-bold border-purple-900 text-white hover:text-purple-300 hover:border-purple-800"
        onClick={connectWallet}
      >
        {buttonLabel}
      </ShadcnButton>
    );
  }

  const handleDisconnect = () => {
    disconnectWallet();

    setShowDisconnectModal(false);
  }

  return (
    <div className="flex flex-col items-center w-full">
      {/* <Profile
        publicAddress={address}
        size="md"
        isShort
        onClick={() => setShowDisconnectModal((prev) => !prev)}
      /> */}
      <ShadcnButton
        variant={"default"} size={"sm"}
        className="ml-auto font-bold border-purple-900 text-white hover:text-purple-300 hover:border-purple-800"
        onClick={() => setShowDisconnectModal((prev) => !prev)}
      >
        {shortenAddress(address)}
      </ShadcnButton>

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
              onClick={handleDisconnect}
              className="w-full mx-auto p-2 text-white"
            >
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
