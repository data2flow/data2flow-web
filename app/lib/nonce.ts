import { createContext, useContext } from "react";

/** CSP nonce. 서버 렌더링 때 entry.server가 넣고, 브라우저에서는 비어 있다(브라우저가 nonce 값을 감춘다) */
export const NonceContext = createContext<string | undefined>(undefined);

export function useNonce() {
  return useContext(NonceContext);
}
