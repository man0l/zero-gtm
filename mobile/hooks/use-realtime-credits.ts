/**
 * Realtime subscription for credit balance updates.
 * Subscribes to postgres_changes on credit_balances table for the current user.
 * Automatically invalidates billing_status query cache when credits change.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useRealtimeCredits(customerId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!customerId) return;

    // Subscribe to credit balance changes for this customer
    const channel = supabase
      .channel(`credits:${customerId}`)
      .on(
        "postgres_changes",
        {
          event: "*", // INSERT, UPDATE, DELETE
          schema: "ninja",
          table: "credit_balances",
          filter: `customer_id=eq.${customerId}`,
        },
        (payload) => {
          console.log("[useRealtimeCredits] Credit balance changed:", payload);
          
          // Invalidate billing status to trigger refetch
          queryClient.invalidateQueries({ queryKey: ["billing_status"] });
          queryClient.invalidateQueries({ queryKey: ["credit_transactions"] });
        }
      )
      .subscribe((status) => {
        console.log(`[useRealtimeCredits] Subscription status: ${status}`);
      });

    return () => {
      channel.unsubscribe();
    };
  }, [customerId, queryClient]);
}
