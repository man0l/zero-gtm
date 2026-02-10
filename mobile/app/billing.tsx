/**
 * Billing screen - Plan info, credit balance, plan comparison, transactions
 */
import { View, Text, ScrollView, Alert } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScreenHeader } from "@/components/screen-header";
import { BottomTabs } from "@/components/bottom-tabs";
import {
  useBillingStatus,
  usePlans,
  useCreateCheckout,
  useCustomerPortal,
  useCreditTransactions,
} from "@/lib/queries";
import { useRealtimeCredits } from "@/hooks/use-realtime-credits";
import { useAuth } from "@/lib/auth";

const PLAN_COLORS: Record<string, string> = {
  free: "bg-gray-500",
  starter: "bg-blue-500",
  growth: "bg-purple-500",
  scale: "bg-orange-500",
};

export default function BillingScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const customerId = session?.user?.id || null;
  
  const { data: billingStatus, isLoading: statusLoading } = useBillingStatus();
  const { data: plans, isLoading: plansLoading } = usePlans();
  const { data: transactions } = useCreditTransactions(20);
  const createCheckout = useCreateCheckout();
  const customerPortal = useCustomerPortal();
  
  // Subscribe to realtime credit updates
  useRealtimeCredits(customerId);

  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);

  // If billing is not enabled, show message
  if (!statusLoading && !billingStatus?.billing_enabled) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Billing" onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-lg text-muted-foreground text-center">
            Billing is not enabled on this instance.
            {"\n\n"}
            Using BYOK (Bring Your Own Keys) mode.
          </Text>
        </View>
        <BottomTabs />
      </View>
    );
  }

  const currentPlan = billingStatus?.plan || "free";
  const credits = billingStatus?.credits;
  const limits = billingStatus?.limits;

  const handleUpgrade = async (planId: string) => {
    if (planId === "free" || planId === currentPlan) return;
    
    setLoadingPlanId(planId);
    try {
      const { checkout_url } = await createCheckout.mutateAsync(planId);
      await WebBrowser.openBrowserAsync(checkout_url);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to create checkout session");
    } finally {
      setLoadingPlanId(null);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const { portal_url } = await customerPortal.mutateAsync();
      await WebBrowser.openBrowserAsync(portal_url);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to open customer portal");
    }
  };

  const totalCredits = credits ? credits.balance + credits.used_this_period : 0;
  const usagePercent = totalCredits > 0
    ? Math.min((credits!.used_this_period / totalCredits) * 100, 100)
    : 0;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Billing" onBack={() => router.back()} />
      
      <ScrollView className="flex-1 p-4">
        {/* Current Plan & Credits */}
        <Card className="mb-4">
          <CardHeader>
            <View className="flex-row items-center justify-between">
              <CardTitle>Current Plan</CardTitle>
              <Badge className={PLAN_COLORS[currentPlan] || "bg-gray-500"}>
                {billingStatus?.plan_name || currentPlan}
              </Badge>
            </View>
          </CardHeader>
          <CardContent>
            {credits && (
              <>
                <View className="mb-4">
                  <View className="flex-row items-baseline justify-between mb-2">
                    <Text className="text-3xl font-bold text-foreground">
                      {credits.balance.toLocaleString()}
                    </Text>
                    <Text className="text-sm text-muted-foreground">
                      credits remaining
                    </Text>
                  </View>
                  
                  <Progress value={usagePercent} className="h-2 mb-2" />
                  
                  <Text className="text-xs text-muted-foreground">
                    {credits.used_this_period.toLocaleString()} used this period
                  </Text>
                </View>

                {limits && (
                  <View className="border-t border-border pt-3">
                    <Text className="text-xs text-muted-foreground mb-2">Plan Limits</Text>
                    <View className="flex-row justify-between">
                      <Text className="text-sm text-foreground">
                        Campaigns: {limits.max_campaigns || "Unlimited"}
                      </Text>
                      <Text className="text-sm text-foreground">
                        Shares: {limits.max_shares || "Unlimited"}
                      </Text>
                    </View>
                  </View>
                )}
              </>
            )}

            {currentPlan !== "free" && (
              <Button
                variant="outline"
                onPress={handleManageSubscription}
                className="mt-4"
                disabled={customerPortal.isPending}
              >
                {customerPortal.isPending ? "Opening..." : "Manage Subscription"}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Plan Comparison */}
        <Text className="text-lg font-semibold text-foreground mb-3">
          Available Plans
        </Text>

        {plansLoading ? (
          <Text className="text-sm text-muted-foreground">Loading plans...</Text>
        ) : (
          plans?.map((plan: any) => (
            <Card key={plan.id} className="mb-3">
              <CardHeader>
                <View className="flex-row items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {plan.id === currentPlan && (
                    <Badge className="bg-green-600">Current</Badge>
                  )}
                </View>
                {plan.description && (
                  <Text className="text-sm text-muted-foreground mt-1">
                    {plan.description}
                  </Text>
                )}
              </CardHeader>
              <CardContent>
                <View className="flex-row items-baseline mb-3">
                  <Text className="text-2xl font-bold text-foreground">
                    ${(plan.price_cents / 100).toFixed(0)}
                  </Text>
                  <Text className="text-sm text-muted-foreground ml-1">/month</Text>
                </View>

                <View className="mb-3">
                  <Text className="text-sm text-foreground mb-1">
                    • {plan.credits_per_month.toLocaleString()} credits/month
                  </Text>
                  <Text className="text-sm text-foreground mb-1">
                    • {plan.max_campaigns || "Unlimited"} campaigns
                  </Text>
                  <Text className="text-sm text-foreground mb-1">
                    • {plan.max_shares || "Unlimited"} share links
                  </Text>
                  {plan.features?.export && (
                    <Text className="text-sm text-foreground mb-1">
                      • Export: {plan.features.export}
                    </Text>
                  )}
                  {plan.features?.priority && (
                    <Text className="text-sm text-foreground mb-1">
                      • Priority processing
                    </Text>
                  )}
                </View>

                {plan.id !== currentPlan && plan.id !== "free" && (
                  <Button
                    onPress={() => handleUpgrade(plan.id)}
                    disabled={loadingPlanId === plan.id || createCheckout.isPending}
                  >
                    {loadingPlanId === plan.id ? "Loading..." : "Upgrade"}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}

        {/* Recent Transactions */}
        <Text className="text-lg font-semibold text-foreground mt-6 mb-3">
          Recent Transactions
        </Text>

        {transactions?.length === 0 ? (
          <Card>
            <CardContent className="py-6">
              <Text className="text-sm text-muted-foreground text-center">
                No transactions yet
              </Text>
            </CardContent>
          </Card>
        ) : (
          transactions?.map((tx: any) => (
            <Card key={tx.id} className="mb-2">
              <CardContent className="py-3">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1">
                    <Text className="text-sm text-foreground font-medium">
                      {tx.description || tx.type}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {new Date(tx.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text
                      className={`text-sm font-semibold ${
                        tx.amount > 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {tx.amount > 0 ? "+" : ""}
                      {tx.amount.toLocaleString()}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      Balance: {tx.balance_after.toLocaleString()}
                    </Text>
                  </View>
                </View>
              </CardContent>
            </Card>
          ))
        )}

        <View className="h-20" />
      </ScrollView>

      <BottomTabs />
    </View>
  );
}
