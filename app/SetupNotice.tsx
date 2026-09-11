export function SetupNotice({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-bold">설정이 필요합니다</h1>
      <p className="mt-3 text-sm text-muted">
        데이터베이스에 연결하지 못했습니다. 아래를 확인하세요.
      </p>
      <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
        <li>
          <a
            href="https://console.neon.tech"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            Neon 콘솔
          </a>
          에서 프로젝트를 만들고 <b>Pooled connection</b> 문자열을 복사합니다.
        </li>
        <li>
          프로젝트 루트에 <code className="rounded bg-surface px-1">.env.local</code> 을 만들고{" "}
          <code className="rounded bg-surface px-1">.env.example</code> 의 항목을 채웁니다.
        </li>
        <li>
          Neon SQL Editor 에 <code className="rounded bg-surface px-1">db/schema.sql</code> 내용을
          붙여넣어 실행합니다.
        </li>
        <li>개발 서버를 재시작합니다.</li>
      </ol>
      <pre className="mt-6 overflow-x-auto rounded-lg border border-border bg-surface p-4 text-xs text-muted">
        {message}
      </pre>
    </main>
  );
}
