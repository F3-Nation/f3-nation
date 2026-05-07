"use client";

import { cn } from "@/lib/utils";
import { Input } from "@acme/ui/input";
import { Textarea } from "@acme/ui/textarea";
import { Label } from "@acme/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@acme/ui/card";
import { Switch } from "@acme/ui/switch";
import { useToast } from "@/components/ui/toast";
import { AvatarUpload } from "@/components/avatar-upload";
import { RegionSelect } from "@/components/region-select";
import { UserSelect } from "@/components/user-select";
import { RoleList } from "@/components/role-list";
import { PositionList } from "@/components/position-list";
import { useProfileForm } from "@/hooks/useProfileForm";
import type { UserProfile, Region } from "@/lib/types";

interface ProfileFormProps {
  user: UserProfile;
  regions: Region[];
}

export function ProfileForm({ user, regions }: ProfileFormProps) {
  const { toast } = useToast();
  const {
    form,
    isFieldDirty,
    dirtyClass: dc,
    updateField,
  } = useProfileForm({
    user,
    toast,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 pb-12">
      {/* Header / Avatar */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Manage your F3 Nation profile information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarUpload
            currentUrl={form.avatarUrl}
            fallbackName={form.f3Name || form.firstName}
            onUploaded={(url) => updateField("avatarUrl", url)}
          />
        </CardContent>
      </Card>

      {/* Two-column grid: Personal Info + Emergency Contact side by side on lg */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Personal Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 pl-2 border-l-[3px] border-l-transparent">
              <Label>Email</Label>
              <Input
                value={user.email}
                disabled
                className="disabled:opacity-70"
              />
              <p className="text-xs text-muted-foreground">
                Email{" "}
                <a
                  href="mailto:it@f3nation.com?subject=Need%20to%20change%20F3%20email%20address"
                  className="text-primary underline hover:text-primary/80"
                >
                  it@f3nation.com
                </a>{" "}
                to change
              </p>
            </div>
            <div className={cn("space-y-2", dc("f3Name"))}>
              <Label htmlFor="f3Name">F3 Name</Label>
              <Input
                id="f3Name"
                value={form.f3Name}
                onChange={(e) => updateField("f3Name", e.target.value)}
                placeholder="Your F3 name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className={cn("space-y-2", dc("firstName"))}>
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={(e) => updateField("firstName", e.target.value)}
                  placeholder="First name"
                />
              </div>
              <div className={cn("space-y-2", dc("lastName"))}>
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={(e) => updateField("lastName", e.target.value)}
                  placeholder="Last name"
                />
              </div>
            </div>
            <div className={cn("space-y-2", dc("phone"))}>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={form.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                placeholder="Phone number"
              />
            </div>
            <div className={cn("space-y-2", dc("homeRegionId"))}>
              <Label>Home Region</Label>
              <RegionSelect
                regions={regions}
                value={form.homeRegionId}
                onChange={(id) => updateField("homeRegionId", id)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Emergency Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Emergency Contact</CardTitle>
            <CardDescription>
              This information is private and only visible to region admins.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={cn("space-y-2", dc("emergencyContact"))}>
              <Label htmlFor="emergencyContact">Contact Name</Label>
              <Input
                id="emergencyContact"
                value={form.emergencyContact}
                onChange={(e) =>
                  updateField("emergencyContact", e.target.value)
                }
                placeholder="Emergency contact name"
              />
            </div>
            <div className={cn("space-y-2", dc("emergencyPhone"))}>
              <Label htmlFor="emergencyPhone">Contact Phone</Label>
              <Input
                id="emergencyPhone"
                type="tel"
                value={form.emergencyPhone}
                onChange={(e) => updateField("emergencyPhone", e.target.value)}
                placeholder="Emergency contact phone"
              />
            </div>
            <div className={cn("space-y-2", dc("emergencyNotes"))}>
              <Label htmlFor="emergencyNotes">Notes</Label>
              <Textarea
                id="emergencyNotes"
                value={form.emergencyNotes}
                onChange={(e) => updateField("emergencyNotes", e.target.value)}
                placeholder="Allergies, medical conditions, etc."
                rows={3}
              />
            </div>
            <div
              className={`flex items-center justify-between gap-4 rounded-lg border border-l-[3px] p-3 ${
                isFieldDirty("user_emergency_info_dr_sharing")
                  ? "border-l-amber-500"
                  : "border-l-transparent"
              }`}
            >
              <div className="space-y-0.5">
                <Label htmlFor="user-emergency-info-dr-sharing">
                  Cross-Region Info Sharing
                </Label>
                <p
                  id="user-emergency-info-dr-sharing-help"
                  className="text-sm text-muted-foreground"
                >
                  If enabled, users can search for your emergency info from
                  other Slack workspaces.
                </p>
              </div>
              <Switch
                id="user-emergency-info-dr-sharing"
                aria-describedby="user-emergency-info-dr-sharing-help"
                checked={form.user_emergency_info_dr_sharing}
                onCheckedChange={(checked) =>
                  updateField("user_emergency_info_dr_sharing", checked)
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* About Me — full width */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">About Me</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cn("space-y-2", dc("f3_name_origin"))}>
              <Label htmlFor="f3NameOrigin">F3 Name Origin</Label>
              <Textarea
                id="f3NameOrigin"
                value={form.f3_name_origin}
                onChange={(e) => updateField("f3_name_origin", e.target.value)}
                placeholder="How did you get your F3 name?"
                rows={3}
              />
            </div>
            <div className={cn("space-y-2", dc("my_f3_why"))}>
              <Label htmlFor="myF3Why">My F3 Why</Label>
              <Textarea
                id="myF3Why"
                value={form.my_f3_why}
                onChange={(e) => updateField("my_f3_why", e.target.value)}
                placeholder="Why do you do F3?"
                rows={3}
              />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cn("space-y-2", dc("start_date_override"))}>
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={form.start_date_override}
                onChange={(e) =>
                  updateField("start_date_override", e.target.value)
                }
              />
            </div>
            <div className={cn("space-y-2", dc("brought_by"))}>
              <Label>Who Brought You?</Label>
              <UserSelect
                value={form.brought_by}
                homeRegionId={form.homeRegionId}
                onChange={(id) => updateField("brought_by", id)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Roles & Positions side by side on lg */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Roles</CardTitle>
            <CardDescription>
              Your current role assignments across F3 regions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RoleList roles={user.roles ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Positions</CardTitle>
            <CardDescription>
              Your current position assignments across F3 regions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PositionList positions={user.positions ?? []} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
