// 授权结果页:callback 处理完成后重定向到这里
// URL 形如 /auth/result?status=success&message=xxx

interface Props {
  searchParams: Promise<{ status?: string; message?: string }>;
}

export default async function AuthResultPage({ searchParams }: Props) {
  const { status, message } = await searchParams;
  const isSuccess = status === 'success';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6">
      <div
        className={`w-full rounded-xl border p-8 text-center ${
          isSuccess
            ? 'border-green-200 bg-green-50'
            : 'border-red-200 bg-red-50'
        }`}
      >
        <div className="mb-4 text-5xl">{isSuccess ? '✅' : '❌'}</div>
        <h1
          className={`mb-2 text-2xl font-bold ${
            isSuccess ? 'text-green-800' : 'text-red-800'
          }`}
        >
          {isSuccess ? '授权成功' : '授权失败'}
        </h1>
        <p
          className={`text-sm ${
            isSuccess ? 'text-green-700' : 'text-red-700'
          }`}
        >
          {message ?? '无详细信息'}
        </p>
        <a
          href="/"
          className="mt-6 inline-block rounded-lg bg-black px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          返回首页
        </a>
      </div>
    </main>
  );
}
