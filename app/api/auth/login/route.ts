import { ConfidentialClientApplication } from "@azure/msal-node";
import { msalServerConfig, REDIRECT_URI } from "@/lib/msal-server-config";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const cca = new ConfidentialClientApplication(msalServerConfig);

    const authCodeUrlParameters = {
      scopes: ["User.Read"],
      redirectUri: REDIRECT_URI,
    };

    const authUrl = await cca.getAuthCodeUrl(authCodeUrlParameters);
    
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error("Login Error:", error);
    return NextResponse.json({ error: "Failed to initiate login" }, { status: 500 });
  }
}
