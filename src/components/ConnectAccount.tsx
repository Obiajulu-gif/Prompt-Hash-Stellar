import React from "react";
import { WalletButton } from "./WalletButton";
import NetworkPill from "./NetworkPill";

const ConnectAccount: React.FC = () => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "10px",
        verticalAlign: "middle",
      }}
    >
      <WalletButton />
      {/* {stellarNetwork !== "PUBLIC" && <FundAccountButton />} */}
      <NetworkPill />
    </div>
  );
};

export default ConnectAccount;
