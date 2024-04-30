import { useRouter } from "vue-router";

import type { LoginPayload, TokenUser } from "@/types/user";
import sessionService from "@/services/session.service";

const REFRESH_INTERVAL = 240000; // 4 minutes, 1 less than token duration

let interval: NodeJS.Timeout | null = null;
let init = true;

export const useAuth = () => {
  const $router = useRouter();

  const loggedIn = computed<boolean>(() => !loading.value && !!data.value);

  // Re-construct state from cookie, also setup a cross-component sync via a useState hack, see https://github.com/nuxt/nuxt/issues/13020#issuecomment-1397282717
  const _accessTokenCookie = useCookie<string | null>("auth:access", {
    default: () => null,
    maxAge: 300,
    sameSite: "strict",
    httpOnly: true,
    secure: true,
  });

  const _refreshTokenCookie = useCookie<string | null>("auth:access", {
    default: () => null,
    maxAge: 300,
    sameSite: "strict",
    httpOnly: true,
    secure: true,
  });

  const data = useState<TokenUser | undefined | null>("auth:data", () => undefined);

  // If session exists, initialize as not loading
  const loading = useState<boolean>("auth:loading", () => true);

  const token = useState("auth:access", () => _accessTokenCookie.value);

  const refreshToken = useState("auth:refresh", () => _refreshTokenCookie.value);

  const _reset = () => {
    data.value = null;
    token.value = null;
    refreshToken.value = null;
    _accessTokenCookie.value = null;
    _refreshTokenCookie.value = null;
    localStorage.removeItem("user");

    if (interval) {
      clearInterval(interval);
    }
  };

  // make request to refresh, update tokens
  const refresh = async () => {
    loading.value = true;

    if (!refreshToken.value) {
      _reset();
      $router.push("/");
      return false;
    }

    try {
      const accesToken = await sessionService.refresh(refreshToken.value);

      token.value = accesToken;

      return true;
    } catch (err) {
      logout();
      return false;
    }
  };

  const login = async (payload: LoginPayload) => {
    loading.value = true;
    const result = await sessionService.login(payload);

    token.value = result.accessToken;
    refreshToken.value = result.refreshToken;
    data.value = result.user;
    loading.value = false;

    localStorage.setItem("user", JSON.stringify(result.user));

    $router.replace("/");
  };

  // make request to logout, update tokens
  const logout = async () => {
    loading.value = true;

    _reset();
    try {
      await sessionService.logout();
      loading.value = false;

      if ($router.currentRoute.value.path !== "/") {
        $router.replace("/");
      }
    } catch (err) {
      window.location.reload();
    }
  };

  watch(token, () => (_accessTokenCookie.value = token.value));

  watch(refreshToken, () => (_refreshTokenCookie.value = token.value));

  if (init) {
    (async (refresh, _reset) => {
      // When the page is cached on a server, set the token on the client
      if (_accessTokenCookie.value && !token.value) {
        token.value = _accessTokenCookie.value;
        refreshToken.value = _refreshTokenCookie.value;
      } else if (_refreshTokenCookie.value && !refreshToken.value) {
        await refresh();
      }

      if (token.value) {
        const storageUser = localStorage.getItem("user");

        if (!storageUser) {
          return _reset();
        }

        const user: TokenUser = JSON.parse(storageUser);

        data.value = user;

        // refresh token every REFRESH_INTERVAL
        interval = setInterval(refresh, REFRESH_INTERVAL);
        loading.value = false;
      }

      init = false;
    })(refresh, _reset);
  } else {
    loading.value = false;
  }

  return { data, loggedIn, token, refreshToken, logout, login, refresh };
};
