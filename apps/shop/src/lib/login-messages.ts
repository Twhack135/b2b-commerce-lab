// The messages of the sign-in page. A plain module (not a client module),
// so the server page can check a reason from the URL and the client form
// can show the same texts after a failed attempt.

export type LoginMessage = { kind: "error" | "success" | "info"; text: string };

export const LOGIN_MESSAGES: Record<string, LoginMessage> = {
  invalid: { kind: "error", text: "Incorrect email or password. Please try again." },
  locked: { kind: "error", text: "Too many attempts. Please wait a few minutes and try again." },
  unavailable: { kind: "error", text: "Sign-in is not available at the moment. Please try again later." },
  // The browser did not confirm that the form came from this shop (CSRF check)
  request: { kind: "error", text: "For your security, the sign-in could not be completed. Please reload this page and try again." },
  signedOut: { kind: "info", text: "You have been signed out." },
  activated: { kind: "success", text: "Your access is ready. Sign in with your new password." },
};

