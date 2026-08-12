/**
 * Valida uma URL de retorno antes de redirecionar.
 *
 * O fluxo OAuth guarda a URL atual (com query params de parceiro) para restaurá-la
 * após o login. Redirecionar para esse valor sem conferir a origem permitiria enviar
 * o usuário a um domínio externo — página falsa logo após um login legítimo.
 *
 * Aceita apenas URLs da própria origem e caminhos relativos.
 * Qualquer outra coisa cai no fallback.
 */
export function safeReturnUrl(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;

  try {
    // Resolve relativo e absoluto contra a origem atual.
    // "//evil.com" vira "https://evil.com" aqui e é barrado na comparação abaixo.
    const url = new URL(raw, window.location.origin);

    if (url.origin !== window.location.origin) return fallback;
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;

    return url.pathname + url.search + url.hash;
  } catch {
    // URL malformada
    return fallback;
  }
}
