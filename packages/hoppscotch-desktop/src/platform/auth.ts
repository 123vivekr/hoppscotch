import axios from "axios"
import {
  AuthEvent,
  AuthPlatformDef,
  HoppUser,
} from "@hoppscotch/common/platform/auth"
import { BehaviorSubject, Subject } from "rxjs"
import {
  getLocalConfig,
  removeLocalConfig,
  setLocalConfig,
} from "@hoppscotch/common/newstore/localpersistence"
import { Ref, ref, watch } from "vue"

export const authEvents$ = new Subject<AuthEvent | { event: "token_refresh" }>()
const currentUser$ = new BehaviorSubject<HoppUser | null>(null)
export const probableUser$ = new BehaviorSubject<HoppUser | null>(null)

import { open } from '@tauri-apps/api/shell';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { getClient, Body, ResponseType } from '@tauri-apps/api/http';

async function logout() {
  await axios.get(`${import.meta.env.VITE_BACKEND_API_URL}/auth/logout`, {
    withCredentials: true,
  })

  // TODO: what creds?
  // const client = await getClient();
  // let url = `${import.meta.env.VITE_BACKEND_API_URL}/auth/logout`;

  // const res = await client.post(url, Body.json({email: email}));
}

async function signInUserWithGithubFB() {
  await open(`${import.meta.env.VITE_BACKEND_API_URL}/auth/github?redirect_uri=desktop`);
}

async function signInUserWithGoogleFB() {
  await open(`${import.meta.env.VITE_BACKEND_API_URL}/auth/google?redirect_uri=desktop`);
}

async function signInUserWithMicrosoftFB() {
  await open(`${import.meta.env.VITE_BACKEND_API_URL}/auth/microsoft?redirect_uri=desktop`);
}

async function getInitialUserDetails() {
  const res = await axios.post<{
    data?: {
      me?: {
        uid: string
        displayName: string
        email: string
        photoURL: string
        isAdmin: boolean
        createdOn: string
        // emailVerified: boolean
      }
    }
    errors?: Array<{
      message: string
    }>
  }>(
    `${import.meta.env.VITE_BACKEND_GQL_URL}`,
    {
      query: `query Me {
      me {
        uid
        displayName
        email
        photoURL
        isAdmin
        createdOn
      }
    }`,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
      withCredentials: true,
    }
  )

  return res.data
}

const isGettingInitialUser: Ref<null | boolean> = ref(null)

function setUser(user: HoppUser | null) {
  currentUser$.next(user)
  probableUser$.next(user)

  setLocalConfig("login_state", JSON.stringify(user))
}

async function setInitialUser() {
  isGettingInitialUser.value = true
  const res = await getInitialUserDetails()

  const error = res.errors && res.errors[0]

  // no cookies sent. so the user is not logged in
  if (error && error.message === "auth/cookies_not_found") {
    setUser(null)
    isGettingInitialUser.value = false
    return
  }

  if (error && error.message === "user/not_found") {
    setUser(null)
    isGettingInitialUser.value = false
    return
  }

  // cookies sent, but it is expired, we need to refresh the token
  if (error && error.message === "Unauthorized") {
    const isRefreshSuccess = await refreshToken()

    if (isRefreshSuccess) {
      setInitialUser()
    } else {
      setUser(null)
      isGettingInitialUser.value = false
    }

    return
  }

  // no errors, we have a valid user
  if (res.data && res.data.me) {
    const hoppBackendUser = res.data.me

    const hoppUser: HoppUser = {
      uid: hoppBackendUser.uid,
      displayName: hoppBackendUser.displayName,
      email: hoppBackendUser.email,
      photoURL: hoppBackendUser.photoURL,
      // all our signin methods currently guarantees the email is verified
      emailVerified: true,
    }

    setUser(hoppUser)

    isGettingInitialUser.value = false

    authEvents$.next({
      event: "login",
      user: hoppUser,
    })

    return
  }
}

async function refreshToken() {
  console.log("REFRESH");
  const res = await axios.get(
    `${import.meta.env.VITE_BACKEND_API_URL}/auth/refresh`,
    {
      withCredentials: true,
    }
  )

  let refresh_token = "";
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i].trim();
    if (cookie.startsWith('refresh_token=')) {
      refresh_token = cookie.substring('refresh_token='.length);
    }
  }

  await invoke('auth_refresh', {
    refreshToken: refresh_token,
    viteBackendApiUrl: `${import.meta.env.VITE_BACKEND_API_URL}/auth/refresh`
  }).then((verify_response: any) => {
    document.cookie = `access_token=${verify_response.refresh_token}`;
    document.cookie = `refresh_token=${verify_response.access_token}`;

    authEvents$.next({ event: "token_refresh" });
  });

  // const client = await getClient();
  // let url = `${import.meta.env.VITE_BACKEND_API_URL}/auth/logout`;

  // const res = await client.post(url, Body.json({ email: email }));

  const isSuccessful = res.status === 200

  if (isSuccessful) {
    authEvents$.next({
      event: "token_refresh",
    })
  }

  return isSuccessful
}

async function sendMagicLink(email: string) {
  const client = await getClient();
  let url = `${import.meta.env.VITE_BACKEND_API_URL}/auth/signin?origin=desktop`;

  const res = await client.post(url, Body.json({ email }));

  if (res.data && res.data.deviceIdentifier) {
    setLocalConfig("deviceIdentifier", res.data.deviceIdentifier)
  } else {
    throw new Error("test: does not get device identifier")
  }

  console.log("deviceIdentifier" + res.data.deviceIdentifier);

  return res.data
}

export const def: AuthPlatformDef = {
  getCurrentUserStream: () => currentUser$,
  getAuthEventsStream: () => authEvents$,
  getProbableUserStream: () => probableUser$,

  getCurrentUser: () => currentUser$.value,
  getProbableUser: () => probableUser$.value,

  getBackendHeaders() {
    return {}
  },
  getGQLClientOptions() {
    return {
      fetchOptions: {
        credentials: "include",
      },
    }
  },

  /**
   * it is not possible for us to know if the current cookie is expired because we cannot access http-only cookies from js
   * hence just returning if the currentUser$ has a value associated with it
   */
  willBackendHaveAuthError() {
    return !currentUser$.value
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onBackendGQLClientShouldReconnect(func) {
    authEvents$.subscribe((event) => {
      if (
        event.event == "login" ||
        event.event == "logout" ||
        event.event == "token_refresh"
      ) {
        func()
      }
    })
  },

  /**
   * we cannot access our auth cookies from javascript, so leaving this as null
   */
  getDevOptsBackendIDToken() {
    return null
  },
  async performAuthInit() {
    const probableUser = JSON.parse(getLocalConfig("login_state") ?? "null")
    probableUser$.next(probableUser)
    await setInitialUser()

    await listen('scheme-request-received', async (event: any) => {
      let deep_link = event.payload as string;

      console.log(deep_link);

      const params = new URLSearchParams(deep_link.split('?')[1]);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const token = params.get('token');

      console.log(token);

      function isNotNullOrUndefined(x: any) {
        return x !== null && x !== undefined;
      }

      if (isNotNullOrUndefined(accessToken) && isNotNullOrUndefined(refreshToken)) {
        document.cookie = `access_token=${accessToken}`;
        document.cookie = `refresh_token=${refreshToken}`;
        window.location.href = "/"
        return;
      }

      if (isNotNullOrUndefined(token)) {
        setLocalConfig("magicLinkUrl", deep_link);
        await this.processMagicLink();
        await setInitialUser();
      }
    });
  },

  waitProbableLoginToConfirm() {
    return new Promise<void>((resolve, reject) => {
      if (this.getCurrentUser()) {
        resolve()
      }

      if (!probableUser$.value) reject(new Error("no_probable_user"))

      const unwatch = watch(isGettingInitialUser, (val) => {
        if (val === true || val === false) {
          resolve()
          unwatch()
        }
      })
    })
  },

  async signInWithEmail(email: string) {
    await sendMagicLink(email)
  },

  isSignInWithEmailLink(url: string) {
    const urlObject = new URL(url)
    const searchParams = new URLSearchParams(urlObject.search)

    return !!searchParams.get("token")
  },

  async verifyEmailAddress() {
    return
  },
  async signInUserWithGoogle() {
    await signInUserWithGoogleFB()
  },
  async signInUserWithGithub() {
    await signInUserWithGithubFB()
    return undefined
  },
  async signInUserWithMicrosoft() {
    await signInUserWithMicrosoftFB()
  },
  async signInWithEmailLink(email: string, url: string) {
    const urlObject = new URL(url)
    const searchParams = new URLSearchParams(urlObject.search)

    const token = searchParams.get("token")
    const deviceIdentifier = getLocalConfig("deviceIdentifier")

    // await invoke('auth_verify', {
    //   token: token,
    //   deviceIdentifier: deviceIdentifier,
    //   viteBackendApiUrl: `${import.meta.env.VITE_BACKEND_API_URL}/auth/verify`
    // }).then((verify_response: any) => {
    //   document.cookie = `access_token=${verify_response.refresh_token}`;
    //   document.cookie = `refresh_token=${verify_response.access_token}`;
    // });

    const client = await getClient();
    let verify_url = `${import.meta.env.VITE_BACKEND_API_URL}/auth/verify`;

    console.log(verify_url);

    const res = await client.post(verify_url, Body.json({
      token,
      deviceIdentifier
    }));

    Object.keys(res.headers).forEach((element) => {
      console.log(element);
    })

    console.log(Object.keys(res.headers));
    console.log(Object.values(res.headers));
    console.log("setcookie" + res.headers["set-cookie"]);
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setEmailAddress(_email: string) {
    return
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setDisplayName(name: string) {
    return
  },

  async signOutUser() {
    // if (!currentUser$.value) throw new Error("No user has logged in")

    await logout()

    probableUser$.next(null)
    currentUser$.next(null)
    removeLocalConfig("login_state")

    authEvents$.next({
      event: "logout",
    })
  },

  async processMagicLink() {
    let url = getLocalConfig("magicLinkUrl") as string;
    if (this.isSignInWithEmailLink(url)) {
      const deviceIdentifier = getLocalConfig("deviceIdentifier")

      if (!deviceIdentifier) {
        throw new Error(
          "Device Identifier not found, you can only signin from the browser you generated the magic link"
        )
      }

      await this.signInWithEmailLink(deviceIdentifier, url)

      removeLocalConfig("deviceIdentifier")

      window.location.href = "/";
    }
  },
}
