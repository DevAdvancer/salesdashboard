import { ConfidentialClientApplication } from "@azure/msal-node";
import { msalServerConfig, REDIRECT_URI } from "@/lib/msal-server-config";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "No authorization code provided" }, { status: 400 });
  }

  try {
    const cca = new ConfidentialClientApplication(msalServerConfig);

    const tokenRequest = {
      code: code,
      scopes: ["User.Read", "Mail.Send"],
      redirectUri: REDIRECT_URI,
    };

    const response = await cca.acquireTokenByCode(tokenRequest);

    if (!response.accessToken) {
      throw new Error("No access token received");
    }

    // Store tokens in HTTP-only cookies
    const cookieStore = await cookies();
    
    cookieStore.set("outlook_access_token", response.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 3600, // 1 hour
    });

    if (response.idToken) {
       cookieStore.set("outlook_id_token", response.idToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 3600,
      });
    }
    
    // Redirect back to the dashboard
    return NextResponse.redirect(new URL("/dashboard", request.url));

  } catch (error: any) {
    console.error("Token Exchange Error:", error);

    // If the code was already redeemed, check if we have a valid session
    // This happens often in development due to React Strict Mode double-invoking the redirect
    const errorDetails = JSON.stringify(error);
    if (errorDetails.includes("AADSTS54005") || errorDetails.includes("already redeemed")) {
      const cookieStore = await cookies();
      if (cookieStore.get("outlook_access_token")) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }

    return NextResponse.json({ error: "Failed to exchange token", details: errorDetails }, { status: 500 });
  }
}
