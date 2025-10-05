import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="min-h-[100svh] bg-gradient-to-b from-[#7A1F2B] to-[#0E5A43] text-white">
      <div className="relative isolate">
        <svg className="absolute -top-16 -right-20 h-56 w-56 opacity-20" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <path fill="#10B981" d="M46.8,-72.4C58.8,-63.3,65.7,-47.7,71.3,-32.1C76.8,-16.6,81.2,-1.1,78.8,13.1C76.4,27.4,67.2,40.5,55.8,51.2C44.4,61.9,30.8,70.1,16.2,74.6C1.7,79.1,-13.9,79.9,-27.9,74.5C-41.9,69.1,-54.2,57.5,-63.2,44.3C-72.2,31.1,-77.9,16.5,-79.3,1.5C-80.7,-13.5,-77.8,-27.1,-70.9,-39.2C-64,-51.4,-53.2,-61.9,-40.6,-70.4C-28,-79,-14,-85.6,0.6,-86.7C15.1,-87.8,30.3,-83.4,46.8,-72.4Z" transform="translate(100 100)" />
        </svg>

        <div className="relative z-10 mx-auto max-w-md px-4 pt-14 pb-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-white">
                <path fill="currentColor" d="M20 3.5A10 10 0 0 0 4.7 19.1L3 22l3-.8A10 10 0 1 0 20 3.5m-8 17a8.9 8.9 0 0 1-4.5-1.2l-.3-.2l-2.7.7l.7-2.6l-.2-.3A8.9 8.9 0 1 1 12 20.5M7.9 7.9c.2-.6.4-.6.7-.6h.6c.2 0 .5 0 .7.6c.2.6.8 2 .8 2s.1.2 0 .4c0 .2-.1.3-.2.5l-.3.4c-.1.2-.3.3-.1.6c.1.2.6 1 1.3 1.6c.9.8 1.6 1 .1.6c.2-.1.4 0 .6.1l.5.4c.2.2.3.4.5.6c.1.2.1.4 0 .6c0 .2-.5 1.3-1.1 1.3c-.6.1-1.2.1-2-.3c-.8-.4-1.7-1-2.5-1.8a10.5 10.5 0 0 1-1.8-2.5c-.4-.8-.4-1.4-.3-2c.1-.6 1.2-1.1 1.3-1.1c.2 0 .4 0 .6.1Z"/>
              </svg>
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-wide">BarakaOps</h1>
              <p className="text-white/80 text-sm">Enter your login code</p>
            </div>
          </div>

          <LoginForm />

          <p className="mt-6 text-center text-xs text-white/70">Having trouble? Contact Admin.</p>
        </div>
      </div>
      <div className="h-4 sm:h-6" />
    </main>
  );
}
