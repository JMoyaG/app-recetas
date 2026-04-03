import { PublicClientApplication } from "@azure/msal-browser";

export const msalInstance = new PublicClientApplication({
  auth: {
    clientId: "e02f4e23-043f-4449-bf1d-0bf9ede9d418",
    authority: "https://login.microsoftonline.com/9dced4f3-81a5-46cb-ac56-6307b1e6d251",
    redirectUri: "http://localhost:5173",
  },
  cache: {
    cacheLocation: "localStorage",
  },
});

export async function initializeMsal() {
  await msalInstance.initialize();

  const response = await msalInstance.handleRedirectPromise();

  if (response?.account) {
    msalInstance.setActiveAccount(response.account);
  } else {
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0 && !msalInstance.getActiveAccount()) {
      msalInstance.setActiveAccount(accounts[0]);
    }
  }
}