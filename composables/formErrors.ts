import { ref } from "vue";
import { useRouter } from "vue-router";

import { useAuth } from "@/store/auth";
import { useNotify } from "@/store/notify";
import type { NuxtError } from "@/exceptions";

export function useFormErrors() {
  const { t } = useI18n();
  const { notifyError } = useNotify();
  const $router = useRouter();
  const { logout } = useAuth();

  const errors = ref<Record<string, string>>({});
  const hasErrors = ref(false);

  const handleErrors = (err: NuxtError) => {
    if (err.statusCode === 401) {
      logout().then(() => $router.push({ path: "/login", query: { requireAuth: "true" } }));
      return;
    }

    if (err.statusCode === 422) {
      // show form errors
      for (const [field, error] of Object.entries(err.data.data || {})) {
        errors.value[field] = error;
      }

      hasErrors.value = true;
      return;
    }

    hasErrors.value = false;
    notifyError(t(err.data?.statusMessage || "errors.unexpected"));
  };

  const clearErrors = () => {
    errors.value = {};
    hasErrors.value = false;
  };

  return { errors, hasErrors, handleErrors, clearErrors };
}
