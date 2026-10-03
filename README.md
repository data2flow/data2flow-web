# data2flow-web

data2flow 화면과 BFF입니다. React Router v7 프레임워크 모드(SSR, Vite) + React + TypeScript로 만들고, 브라우저는 토큰 없이 HttpOnly 세션 쿠키만 갖습니다(BFF가 토큰을 서버 쪽에 보관). 화면 문구는 한국어·영어·일본어·중국어 4개 언어입니다(ADR-037).

- 관련 스펙: DSH, FLW·RUL 화면, IAM-07 (정본은 비공개 저장소 `data2flow-docs`)
- 포트: 8080. 프로브는 `/healthz`

## 개발

```bash
pnpm install
pnpm dev               # http://localhost:5173
pnpm typecheck
pnpm test:coverage     # 단위 테스트 + 커버리지 80%, i18n 키 일치(TC-DSH-075)
pnpm build && pnpm start
```

문구를 추가할 때는 `app/i18n/locales/{ko,en,ja,zh}.json` 네 파일에 같은 키를 넣습니다. 키가 하나라도 다르면 테스트가 실패합니다.
