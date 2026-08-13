/**
 * Valida uma URL antes de redirecionar, aceitando SOMENTE a própria origem.
 *
 * Use no retorno do OAuth: o fluxo guarda `window.location.href` (a própria
 * origem do checkout) para restaurar a URL com os params de parceiro depois do
 * login. Redirecionar para esse valor sem conferir a origem permitiria enviar o
 * usuário a um domínio externo — página falsa logo após um login legítimo.
 *
 * NÃO use para o retorno pós-pagamento ao app principal: aquele destino é outra
 * origem (app.deserty.com.br) e é validado por `safeReturnUrl`, em CheckoutPage,
 * que compara contra VITE_APP_URL. São checagens distintas de propósito.
 *
 * Aceita URLs da própria origem e caminhos relativos; o resto cai no fallback.
 */
export function safeSameOriginUrl(raw: string | null | undefined, fallback = "/"): string {
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
