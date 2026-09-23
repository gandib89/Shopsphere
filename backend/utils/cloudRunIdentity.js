export const createCloudRunIdentityTokenProvider = (audience, { fetchImpl = fetch } = {}) => {
  const origin = new URL(audience);
  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".run.app") || origin.username || origin.password
    || origin.port || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Cloud Run service origin must be an HTTPS run.app origin");
  }
  const url = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
  url.searchParams.set("audience", origin.origin);
  return async () => {
    const response = await fetchImpl(url, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Cloud Run identity token unavailable");
    const token = (await response.text()).trim();
    if (!token) throw new Error("Cloud Run identity token unavailable");
    return token;
  };
};
