import React, { useEffect, useState } from "react";
import BoringAvatar from "boring-avatars";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getProfileAvatarUrl } from "@/lib/profile/profileStorage";

export interface UserAvatarProps {
  address?: string;
  avatarUrl?: string; // Explicit override
  size?: number;
  className?: string;
}

export function UserAvatar({
  address = "default",
  avatarUrl,
  size = 40,
  className,
}: UserAvatarProps) {
  const [localUrl, setLocalUrl] = useState<string | null>(getProfileAvatarUrl(address));

  // Listen for local updates to sync avatars across tabs/components
  useEffect(() => {
    const handleUpdate = () => {
      setLocalUrl(getProfileAvatarUrl(address));
    };
    window.addEventListener("avatar_updated", handleUpdate);
    return () => window.removeEventListener("avatar_updated", handleUpdate);
  }, [address]);

  const url = avatarUrl || localUrl;

  return (
    <Avatar className={className} style={{ width: size, height: size }}>
      {url ? (
        <AvatarImage src={url} alt={address} className="object-cover" />
      ) : null}
      <AvatarFallback className="bg-transparent text-transparent">
        <BoringAvatar
          size={size}
          name={address}
          variant="beam"
          colors={["#0ea5e9", "#14b8a6", "#f59e0b", "#f43f5e", "#8b5cf6"]}
        />
      </AvatarFallback>
    </Avatar>
  );
}
