"use server";

/** Which of the authentication plugin's providers this playground is configured for. */
export async function configuredProviders(): Promise<{ id: string; name: string }[]> {
  return [
    { id: "steam", name: "Steam" },
    ...(process.env.EPIC_CLIENT_ID && process.env.EPIC_CLIENT_SECRET
      ? [{ id: "epic", name: "Epic Games" }]
      : []),
    ...(process.env.XBOX_CLIENT_ID && process.env.XBOX_CLIENT_SECRET
      ? [{ id: "xbox", name: "Xbox" }]
      : []),
  ];
}
