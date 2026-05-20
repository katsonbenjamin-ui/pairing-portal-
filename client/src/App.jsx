import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PairingPortal } from "./components/PairingPortal.jsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
    mutations: { retry: 0 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PairingPortal />
    </QueryClientProvider>
  );
}
