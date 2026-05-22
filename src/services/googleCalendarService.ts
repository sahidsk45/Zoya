import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// We add Google Calendar scope to provider
provider.addScope("https://www.googleapis.com/auth/calendar");

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Initialize auth state listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // If we already have a token cached in memory, trigger success instantly
  const currentUser = auth.currentUser;
  if (currentUser && cachedAccessToken) {
    if (onAuthSuccess) onAuthSuccess(currentUser, cachedAccessToken);
  }

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        // Token is not cached yet, caller can request login
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get Google Calendar access token from Auth result");
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Sign in with Google failed:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export const getAccessToken = () => cachedAccessToken;

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
}

// Fetch 15 upcoming events
export async function listCalendarEvents(): Promise<CalendarEvent[]> {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error("User is not authenticated or access token is missing.");
  }

  const now = new Date().toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?orderBy=startTime&singleEvents=true&timeMin=${encodeURIComponent(now)}&maxResults=15`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Calendar API Error: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  return data.items || [];
}

// Quick Add Event
export async function createCalendarEvent(
  summary: string,
  startTime: string, // ISO format or LocalDateTime string
  durationMinutes: number = 30,
  description?: string
): Promise<CalendarEvent> {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error("User is not authenticated or access token is missing.");
  }

  const startDt = new Date(startTime);
  const endDt = new Date(startDt.getTime() + durationMinutes * 60 * 1000);

  const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const body = {
    summary,
    description: description || "Scheduled by Gimi Sassy Assistant",
    start: {
      dateTime: startDt.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    end: {
      dateTime: endDt.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Calendar Create Error: ${response.status} - ${errorBody}`);
  }

  return response.json();
}

// Delete Event
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error("User is not authenticated or access token is missing.");
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Calendar Delete Error: ${response.status} - ${errorBody}`);
  }

  return true;
}
