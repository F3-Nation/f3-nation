"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/toast";
import { AvatarUpload } from "@/components/avatar-upload";
import { RegionSelect } from "@/components/region-select";
import { RoleList } from "@/components/role-list";
import { PositionList } from "@/components/position-list";
import type { UserProfile, UserMeta, Region } from "@/lib/types";

interface ProfileFormProps {
  user: UserProfile;
  regions: Region[];
  positions: {
    orgId: number;
    orgName?: string;
    positionId: number;
    positionName: string;
  }[];
}

function parseMeta(meta: string | null): UserMeta {
  if (!meta) return {};
  try {
    return JSON.parse(meta) as UserMeta;
  } catch {
    return {};
  }
}

export function ProfileForm({ user, regions, positions }: ProfileFormProps) {
  const meta = parseMeta(user.meta);
  const { toast } = useToast();

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    f3Name: user.f3Name ?? "",
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    phone: user.phone ?? "",
    homeRegionId: user.homeRegionId,
    avatarUrl: user.avatarUrl,
    emergencyContact: user.emergencyContact ?? "",
    emergencyPhone: user.emergencyPhone ?? "",
    emergencyNotes: user.emergencyNotes ?? "",
    f3_name_origin: (meta.f3_name_origin as string) ?? "",
    my_f3_why: (meta.my_f3_why as string) ?? "",
    user_emergency_info_dr_sharing:
      (meta.user_emergency_info_dr_sharing as boolean) ?? false,
    start_date_override: (meta.start_date_override as string) ?? "",
  });

  const updateField = useCallback(
    <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          f3Name: form.f3Name,
          firstName: form.firstName || null,
          lastName: form.lastName,
          phone: form.phone || null,
          homeRegionId: form.homeRegionId,
          emergencyContact: form.emergencyContact || null,
          emergencyPhone: form.emergencyPhone || null,
          emergencyNotes: form.emergencyNotes || null,
          f3_name_origin: form.f3_name_origin || undefined,
          my_f3_why: form.my_f3_why || undefined,
          user_emergency_info_dr_sharing: form.user_emergency_info_dr_sharing,
          start_date_override: form.start_date_override || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to save profile");
      }

      toast({
        title: "Profile saved",
        description: "Your changes have been saved successfully.",
      });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-12">
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

      {/* Personal Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="f3Name">F3 Name</Label>
            <Input
              id="f3Name"
              value={form.f3Name}
              onChange={(e) => updateField("f3Name", e.target.value)}
              placeholder="Your F3 name"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={(e) => updateField("firstName", e.target.value)}
                placeholder="First name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={form.lastName}
                onChange={(e) => updateField("lastName", e.target.value)}
                placeholder="Last name"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={form.phone}
              onChange={(e) => updateField("phone", e.target.value)}
              placeholder="Phone number"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="homeRegion">Home Region</Label>
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
          <div className="space-y-2">
            <Label htmlFor="emergencyContact">Contact Name</Label>
            <Input
              id="emergencyContact"
              value={form.emergencyContact}
              onChange={(e) => updateField("emergencyContact", e.target.value)}
              placeholder="Emergency contact name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emergencyPhone">Contact Phone</Label>
            <Input
              id="emergencyPhone"
              type="tel"
              value={form.emergencyPhone}
              onChange={(e) => updateField("emergencyPhone", e.target.value)}
              placeholder="Emergency contact phone"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emergencyNotes">Notes</Label>
            <Textarea
              id="emergencyNotes"
              value={form.emergencyNotes}
              onChange={(e) => updateField("emergencyNotes", e.target.value)}
              placeholder="Allergies, medical conditions, etc."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* About Me */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">About Me</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="f3NameOrigin">F3 Name Origin</Label>
            <Textarea
              id="f3NameOrigin"
              value={form.f3_name_origin}
              onChange={(e) => updateField("f3_name_origin", e.target.value)}
              placeholder="How did you get your F3 name?"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="myF3Why">My F3 Why</Label>
            <Textarea
              id="myF3Why"
              value={form.my_f3_why}
              onChange={(e) => updateField("my_f3_why", e.target.value)}
              placeholder="Why do you do F3?"
              rows={3}
            />
          </div>
          <div className="space-y-2">
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

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label>Cross-Region Info Sharing</Label>
              <p className="text-sm text-muted-foreground">
                If enabled, users can search for your info from other Slack
                workspaces.
              </p>
            </div>
            <Switch
              checked={form.user_emergency_info_dr_sharing}
              onCheckedChange={(checked) =>
                updateField("user_emergency_info_dr_sharing", checked)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Roles */}
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

      {/* Positions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Positions</CardTitle>
          <CardDescription>
            Your current position assignments across F3 regions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PositionList positions={positions} />
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button size="lg" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
