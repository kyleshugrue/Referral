import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Match } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Building2, Briefcase } from "lucide-react";
import ProtectedLayout from "@/components/protected-layout";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function ReferralsPage() {
  const [, setLocation] = useLocation();
  const { data: referrals = [], isLoading: isLoadingReferrals } = useQuery<
    Array<Match>
  >({
    queryKey: ["/api/matches/referrals"],
  });

  if (isLoadingReferrals) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]">
        <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin" />
      </div>
    );
  }

  return (
    <ProtectedLayout>
      <div className="max-w-4xl mx-auto pt-20 pb-6 sm:pb-12 px-4">
        <h1 className="text-2xl sm:text-3xl font-bold mb-6 sm:mb-8" style={{ color: 'hsl(215, 25%, 27%)' }}>Your Referrals</h1>

        <div className="space-y-4 sm:space-y-6">
          {referrals.length > 0 ? (
            referrals.map((referral) => (
              <Card key={referral.id}>
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-0">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="h-12 w-12 rounded-full overflow-hidden flex-shrink-0">
                        <img
                          src={referral.matchedUser.photo}
                          alt={referral.matchedUser.fullName}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-base sm:text-lg truncate">
                          {referral.matchedUser.fullName}
                        </h3>
                        <div className="flex flex-wrap gap-2 mt-1">
                          <Badge variant="secondary" className="flex items-center gap-1">
                            <Building2 className="w-3 h-3" />
                            {referral.matchedUser.currentCompany}
                          </Badge>
                          <Badge variant="secondary" className="flex items-center gap-1">
                            <Briefcase className="w-3 h-3" />
                            {referral.matchedUser.industry}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <Button 
                      size="sm" 
                      className="w-full sm:w-auto gap-2"
                      onClick={() => setLocation(`/chat/${referral.matchedUser.id}`)}
                    >
                      <MessageSquare className="h-4 w-4" />
                      Message
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="text-center py-8 sm:py-12">
              <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-2">
                No referrals yet
              </h2>
              <p className="text-sm sm:text-base text-gray-500">
                Start matching with other professionals to build your network
              </p>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  );
}