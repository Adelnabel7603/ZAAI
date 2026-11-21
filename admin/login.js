(function () {
  const form = document.getElementById("owner-login-form");
  const errorBox = document.getElementById("login-error");
  const submit = document.getElementById("login-submit");
  const toggle = document.getElementById("toggle-password");
  const password = document.getElementById("login-password");
  let csrfToken = "";

  async function loadCsrf() {
    const response = await fetch("/api/admin/csrf", { credentials: "include" });
    if (!response.ok) throw new Error("تعذر بدء جلسة الدخول.");
    const data = await response.json();
    csrfToken = data.csrfToken;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  toggle.addEventListener("click", () => {
    const visible = password.type === "text";
    password.type = visible ? "password" : "text";
    toggle.textContent = visible ? "إظهار" : "إخفاء";
    toggle.setAttribute("aria-label", visible ? "إظهار كلمة المرور" : "إخفاء كلمة المرور");
  });

  submit.disabled = true;
  loadCsrf()
    .then(() => { submit.disabled = false; })
    .catch((error) => {
      submit.disabled = false;
      showError(error.message);
    });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    submit.disabled = true;
    submit.querySelector("span").textContent = "جارٍ تسجيل الدخول...";
    try {
      if (!csrfToken) await loadCsrf();
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({
          email: document.getElementById("login-email").value,
          password: password.value
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر تسجيل الدخول.");
      window.location.assign("/admin");
    } catch (error) {
      showError(error.message);
    } finally {
      submit.disabled = false;
      submit.querySelector("span").textContent = "تسجيل الدخول إلى لوحة التحكم";
    }
  });
})();
