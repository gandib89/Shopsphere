export const createCloudRunIdentityTokenProvider = (audience, { fetchImpl = fetch } = {}) => {
  const url = new URL(audience);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".run.app") || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Cloud Run backend origin must be an HTTPS run.app origin");
  }

  const metadataUrl = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
  metadataUrl.searchParams.set("audience", url.origin);

  return async () => {
    const response = await fetchImpl(metadataUrl, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Cloud Run identity token unavailable");
    const token = (await response.text()).trim();
    if (!token) throw new Error("Cloud Run identity token unavailable");
    return token;
  };
};
