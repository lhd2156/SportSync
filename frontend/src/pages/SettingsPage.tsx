/**
 * SportSync - Settings Page
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SafeAvatar from "../components/SafeAvatar";
import apiClient from "../api/client";
import { API, ROUTES, SUPPORTED_SPORTS } from "../constants";

const inputCls =
  "w-full rounded-2xl border border-[#263452] bg-[#0d1322]/90 px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 placeholder:text-muted/55";
const readOnlyCls =
  "w-full rounded-2xl border border-[#202c47] bg-[#0a1120]/70 px-4 py-3 text-sm text-muted/80";
const cardCls =
  "relative overflow-hidden rounded-[28px] border border-[#24314d] bg-[linear-gradient(180deg,rgba(15,21,35,0.96),rgba(10,16,27,0.96))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)]";

const LEAGUE_API_MAP = {
  NFL: "NFL",
  NBA: "NBA",
  MLB: "MLB",
  NHL: "NHL",
  EPL: "English Premier League",
} as const;

const LEAGUE_ORDER = ["NFL", "NBA", "MLB", "NHL", "EPL"] as const;
type LeagueKey = (typeof LEAGUE_ORDER)[number];
const DEFAULT_PROFILE_FIRST_NAME = "John";
const DEFAULT_PROFILE_LAST_NAME = "Doe";

interface SportsDBTeam {
  idTeam: string;
  strTeam: string;
  strTeamShort: string;
  strBadge: string;
}

interface TeamItem {
  id: string;
  requestId: string;
  dbId?: string;
  name: string;
  shortName: string;
  league: LeagueKey;
  logo: string;
}

interface SavedTeamResponse {
  id: string;
  external_id?: string;
  name: string;
  short_name?: string;
  sport?: string;
  league?: string;
  logo_url?: string;
  city?: string;
}

interface TeamCatalogResponse {
  id: string;
  external_id?: string;
  name: string;
  short_name?: string;
  league?: string;
  sport?: string;
  logo_url?: string;
  city?: string;
}

interface TeamGroup {
  name: string;
  teams: string[];
  teamIds: string[];
}

interface TeamGroupsResponse {
  groups?: TeamGroup[];
}

function initialsFor(firstName: string, lastName: string): string {
  const parts = [firstName.trim(), lastName.trim()].filter(Boolean);
  if (parts.length < 2) return "JD";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function buildPreviewName(firstName: string, lastName: string): string {
  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
  if (!firstName.trim() || !lastName.trim()) {
    return `${DEFAULT_PROFILE_FIRST_NAME} ${DEFAULT_PROFILE_LAST_NAME}`;
  }
  return fullName || `${DEFAULT_PROFILE_FIRST_NAME} ${DEFAULT_PROFILE_LAST_NAME}`;
}

function formatProvider(provider: string | null, hasPassword: boolean): string {
  if (provider === "google" && hasPassword) return "Google + Email";
  if (provider === "google") return "Google";
  return "Email";
}

function normalizeTeamName(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

function resolveLeagueKey(value: string | null | undefined): LeagueKey | null {
  const normalizedValue = (value || "").trim().toLowerCase();
  if (!normalizedValue) return null;

  for (const league of LEAGUE_ORDER) {
    if (league.toLowerCase() === normalizedValue) return league;
    if (LEAGUE_API_MAP[league].toLowerCase() === normalizedValue) return league;
  }

  if (normalizedValue.includes("premier")) return "EPL";
  return null;
}

function getFilterTitle(league: LeagueKey | null): string {
  if (league === null) return "League";
  if (league === "NBA") return "Conference";
  if (league === "EPL") return "Table";
  return "Division";
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5h18" />
      <path d="M7 12h10" />
      <path d="M10 19h4" />
    </svg>
  );
}

function Section({
  eyebrow,
  title,
  description,
  children,
  accent,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  accent: string;
}) {
  return (
    <section className={`${cardCls} ${accent}`}>
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(10,121,255,0.08),transparent_34%)]" />
      <div className="relative">
        <p className="text-[11px] uppercase tracking-[0.28em] text-accent/80">{eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#24324d] bg-[#09111d]/75 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted/70">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function TeamFilterPanel({
  title,
  groups,
  selectedGroups,
  emptyStateText,
  isLoading,
  layout = "stack",
  onClearAll,
  onToggleGroup,
}: {
  title: string;
  groups: TeamGroup[];
  selectedGroups: string[];
  emptyStateText?: string;
  isLoading: boolean;
  layout?: "stack" | "grid";
  onClearAll: () => void;
  onToggleGroup: (groupName: string) => void;
}) {
  const canClear = selectedGroups.length > 0;

  return (
    <div className="rounded-2xl border border-[#24314d] bg-[#09111d]/75 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-muted/65">
            <FilterIcon />
            Filter
          </div>
          <h3 className="mt-2 text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <button
          type="button"
          onClick={onClearAll}
          disabled={!canClear}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
            canClear ? "bg-accent text-white hover:bg-accent-hover" : "bg-accent text-white opacity-55"
          }`}
        >
          Clear all
        </button>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-10 animate-pulse rounded-xl border border-muted/10 bg-background/40" />
          ))}
        </div>
      ) : groups.length > 0 ? (
        <div className={layout === "grid" ? "grid grid-cols-2 gap-2 md:grid-cols-3" : "flex flex-col gap-2"}>
          {groups.map((group) => {
            const isActive = selectedGroups.includes(group.name);
            return (
              <button
                key={group.name}
                type="button"
                onClick={() => onToggleGroup(group.name)}
                className={`rounded-xl border px-3 py-2 text-left text-sm transition-all ${
                  isActive
                    ? "border-accent bg-accent text-white shadow-[0_0_0_1px_rgba(46,142,255,0.16)]"
                    : "border-muted/15 bg-background/40 text-muted hover:border-muted/30 hover:text-foreground"
                }`}
              >
                {group.name}
              </button>
            );
          })}
        </div>
      ) : emptyStateText ? (
        <p className="text-xs leading-6 text-muted">{emptyStateText}</p>
      ) : null}
    </div>
  );
}

export default function SettingsPage() {
  const { user, refreshAuth, logout } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showFeedDNA, setShowFeedDNA] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("settings-hide-feed-dna") !== "true";
  });

  const [email, setEmail] = useState(user?.email || "");
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [displayHandle, setDisplayHandle] = useState(user?.displayName || "");
  const [gender, setGender] = useState(user?.gender || "");
  const [profilePictureUrl, setProfilePictureUrl] = useState(user?.profilePictureUrl || "");
  const [selectedSports, setSelectedSports] = useState<string[]>(user?.sports || []);
  const [provider, setProvider] = useState<string | null>(user?.provider || null);
  const [createdAt, setCreatedAt] = useState(user?.createdAt || "");
  const [hasPassword, setHasPassword] = useState(Boolean(user?.hasPassword));

  const [savedTeamIds, setSavedTeamIds] = useState<string[]>([]);
  const [savedTeams, setSavedTeams] = useState<TeamItem[]>([]);
  const [teamsCatalog, setTeamsCatalog] = useState<TeamItem[]>([]);
  const [activeTeamLeague, setActiveTeamLeague] = useState<LeagueKey | null>("NFL");
  const [selectedGroupNames, setSelectedGroupNames] = useState<string[]>([]);
  const [groupsByLeague, setGroupsByLeague] = useState<Partial<Record<LeagueKey, TeamGroup[]>>>({});
  const [groupLoadingLeague, setGroupLoadingLeague] = useState<LeagueKey | null>(null);
  const [teamSearchQuery, setTeamSearchQuery] = useState("");

  const [loadMsg, setLoadMsg] = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const [profileError, setProfileError] = useState("");
  const [teamsLoadMsg, setTeamsLoadMsg] = useState("");
  const [feedSetupMsg, setFeedSetupMsg] = useState("");
  const [feedSetupError, setFeedSetupError] = useState("");
  const [teamSelectionMsg, setTeamSelectionMsg] = useState("");
  const [teamSelectionError, setTeamSelectionError] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingFeedSetup, setIsSavingFeedSetup] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isTogglingTeamId, setIsTogglingTeamId] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  async function loadSavedTeams() {
    try {
      const response = await apiClient.get(API.USER_TEAMS);
      const nextSavedTeams: TeamItem[] = (Array.isArray(response.data) ? response.data : [])
        .map((team: SavedTeamResponse) => {
          const league = resolveLeagueKey(team.league || team.sport);
          if (!league) return null;
          return {
            id: (team.external_id || team.id || "").trim(),
            requestId: (team.external_id || team.id || "").trim(),
            dbId: (team.id || "").trim(),
            name: team.name || "",
            shortName: team.short_name || team.name?.slice(0, 3)?.toUpperCase() || "TEAM",
            league,
            logo: team.logo_url || "",
          };
        })
        .filter((team): team is TeamItem => Boolean(team?.id && team?.name))
        .sort((left, right) => {
          const leftIndex = LEAGUE_ORDER.indexOf(left.league);
          const rightIndex = LEAGUE_ORDER.indexOf(right.league);
          if (leftIndex !== rightIndex) return leftIndex - rightIndex;
          return left.name.localeCompare(right.name);
        });

      setSavedTeams(nextSavedTeams);
      setSavedTeamIds(nextSavedTeams.map((team) => team.id));
      setTeamsLoadMsg("");
    } catch {
      setTeamsLoadMsg("Saved team controls will sync once the backend finishes loading.");
    }
  }

  async function loadTeamsCatalog() {
    try {
      const response = await apiClient.get<TeamCatalogResponse[]>(API.TEAMS, {
        params: { page_size: 500 },
      });

      const nextCatalog = (Array.isArray(response.data) ? response.data : [])
        .map((team) => {
          const league = resolveLeagueKey(team.league || team.sport);
          const requestId = (team.external_id || team.id || "").trim();
          if (!league || !requestId) return null;
          return {
            id: requestId,
            requestId,
            dbId: (team.id || "").trim(),
            name: team.name || "",
            shortName: team.short_name || team.name?.slice(0, 3)?.toUpperCase() || "TEAM",
            league,
            logo: team.logo_url || "",
          } satisfies TeamItem;
        })
        .filter((team): team is TeamItem => Boolean(team?.id && team?.name))
        .sort((left, right) => {
          const leftIndex = LEAGUE_ORDER.indexOf(left.league);
          const rightIndex = LEAGUE_ORDER.indexOf(right.league);
          if (leftIndex !== rightIndex) return leftIndex - rightIndex;
          return left.name.localeCompare(right.name);
        });

      setTeamsCatalog(nextCatalog);
      if (nextCatalog.length === 0) {
        setTeamsLoadMsg("Team setup is temporarily unavailable. Retry once the backend is ready.");
      } else {
        setTeamsLoadMsg("");
      }
    } catch {
      setTeamsLoadMsg("Team setup is temporarily unavailable. Retry once the backend is ready.");
    }
  }

  async function loadTeamSelectionData() {
    setIsLoadingTeams(true);
    setTeamsLoadMsg("");
    setTeamSelectionError("");
    await Promise.all([loadSavedTeams(), loadTeamsCatalog()]);
    setIsLoadingTeams(false);
  }

  useEffect(() => {
    let active = true;

    async function loadProfile() {
    if (user) {
        setEmail(user.email || "");
        setFirstName(user.firstName || "");
        setLastName(user.lastName || "");
        setDisplayHandle(user.displayName || "");
        setGender(user.gender || "");
        setProfilePictureUrl(user.profilePictureUrl || "");
        setSelectedSports(user.sports || []);
        setProvider(user.provider || null);
        setCreatedAt(user.createdAt || "");
        setHasPassword(Boolean(user.hasPassword));
      }

      try {
        setLoadMsg("");
        const response = await apiClient.get(API.USER_PROFILE);
        if (!active) return;
        const data = response.data || {};
        setEmail(data.email || "");
        setFirstName(data.first_name || "");
        setLastName(data.last_name || "");
        setDisplayHandle(data.display_name || "");
        setGender(data.gender || "");
        setProfilePictureUrl(data.profile_picture_url || "");
        setSelectedSports(Array.isArray(data.sports) ? data.sports : []);
        setProvider(data.provider || null);
        setCreatedAt(data.created_at || "");
        setHasPassword(Boolean(data.has_password));
      } catch {
        if (!active) return;
        setLoadMsg("Using the current session snapshot. Some account details may refresh after the backend catches up.");
      } finally {
        if (active) setIsLoadingProfile(false);
      }
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    void loadTeamSelectionData();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("settings-hide-feed-dna", String(!showFeedDNA));
  }, [showFeedDNA]);

  const availableLeagues = LEAGUE_ORDER.filter((league) => teamsCatalog.some((team) => team.league === league));

  useEffect(() => {
    if (activeTeamLeague && !availableLeagues.includes(activeTeamLeague)) {
      setActiveTeamLeague(availableLeagues[0] ?? null);
      setSelectedGroupNames([]);
    }
  }, [activeTeamLeague, availableLeagues]);

  useEffect(() => {
    if (teamsCatalog.length > 0) {
      setTeamSelectionError("");
    }
  }, [teamsCatalog.length]);

  useEffect(() => {
    if (!activeTeamLeague || groupsByLeague[activeTeamLeague] !== undefined) {
      return;
    }

    let cancelled = false;

    async function fetchGroups() {
      setGroupLoadingLeague(activeTeamLeague);

      try {
        const response = await apiClient.get<TeamGroupsResponse>("/api/sports/team-groups", {
          params: { league: activeTeamLeague },
        });

        if (!cancelled) {
          setGroupsByLeague((current) => ({
            ...current,
            [activeTeamLeague]: response.data.groups || [],
          }));
        }
      } catch {
        if (!cancelled) {
          setGroupsByLeague((current) => ({
            ...current,
            [activeTeamLeague]: [],
          }));
        }
      } finally {
        if (!cancelled) {
          setGroupLoadingLeague((current) => (current === activeTeamLeague ? null : current));
        }
      }
    }

    void fetchGroups();
    return () => {
      cancelled = true;
    };
  }, [activeTeamLeague, groupsByLeague]);

  function toggleSport(id: string) {
    setSelectedSports((previous) =>
      previous.includes(id) ? previous.filter((sportId) => sportId !== id) : [...previous, id],
    );
  }

  function openAvatarPicker() {
    fileInputRef.current?.click();
  }

  function onAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setProfileError("Choose an image file for the profile picture.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileError("Keep the profile picture under 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setProfilePictureUrl(result);
      setProfileError("");
      setProfileMsg("Avatar staged. Save profile to publish it.");
    };
    reader.onerror = () => {
      setProfileError("Could not read that image.");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  async function handleProfileSave(event: FormEvent) {
    event.preventDefault();
    setProfileMsg("");
    setProfileError("");

    if (!firstName.trim() || !lastName.trim()) {
      setProfileError("First and last name are both required.");
      return;
    }
    if (!displayHandle.trim()) {
      setProfileError("Display handle is required.");
      return;
    }

    setIsSavingProfile(true);
    try {
      await apiClient.put(API.USER_PROFILE, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        display_name: displayHandle.trim(),
        gender: gender || null,
        profile_picture_url: profilePictureUrl.trim(),
        sports: selectedSports,
      });
      await refreshAuth();
      setProfileMsg("Profile updated.");
    } catch (error: any) {
      setProfileError(error?.response?.data?.detail || "Could not save profile.");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleFeedSetupSave() {
    setFeedSetupMsg("");
    setFeedSetupError("");
    setIsSavingFeedSetup(true);
    try {
      await apiClient.put(API.USER_PROFILE, {
        sports: selectedSports,
      });
      await refreshAuth();
      setFeedSetupMsg(
        selectedSports.length
          ? "Dashboard focus updated."
          : "Dashboard focus cleared. Feed will stay on All by default.",
      );
    } catch (error: any) {
      setFeedSetupError(error?.response?.data?.detail || "Could not update dashboard setup.");
    } finally {
      setIsSavingFeedSetup(false);
    }
  }

  async function handlePasswordSave(event: FormEvent) {
    event.preventDefault();
    setPasswordMsg("");
    setPasswordError("");

    if (hasPassword && !currentPassword) {
      setPasswordError("Current password is required.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    setIsSavingPassword(true);
    try {
      await apiClient.post(API.AUTH_CHANGE_PASSWORD, {
        current_password: hasPassword ? currentPassword : undefined,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setHasPassword(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg(hasPassword ? "Password updated." : "Password created.");
    } catch (error: any) {
      setPasswordError(error?.response?.data?.detail || "Could not update password.");
    } finally {
      setIsSavingPassword(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleteError("");
    if (deleteConfirmText.trim().toUpperCase() !== "DELETE") {
      setDeleteError('Type "DELETE" to confirm account removal.');
      return;
    }
    if (hasPassword && !deletePassword) {
      setDeleteError("Current password is required.");
      return;
    }

    setIsDeletingAccount(true);
    try {
      await apiClient.delete(API.USER_ACCOUNT, {
        data: {
          confirm_text: deleteConfirmText.trim(),
          current_password: deletePassword || undefined,
        },
      });
      await logout();
      navigate(ROUTES.LOGIN, { replace: true });
    } catch (error: any) {
      setDeleteError(error?.response?.data?.detail || "Could not delete account.");
    } finally {
      setIsDeletingAccount(false);
    }
  }

  async function handleTeamToggle(team: TeamItem) {
    if (isTogglingTeamId === team.id) return;

    const isSaved = savedTeamIds.includes(team.id);
    const previousSavedIds = savedTeamIds;
    const previousSavedTeams = savedTeams;
    const nextSavedIds = isSaved ? savedTeamIds.filter((savedId) => savedId !== team.id) : [...savedTeamIds, team.id];
    const nextSavedTeams = isSaved
      ? savedTeams.filter((savedTeam) => savedTeam.id !== team.id)
      : [...savedTeams, team].sort((left, right) => {
          const leftIndex = LEAGUE_ORDER.indexOf(left.league);
          const rightIndex = LEAGUE_ORDER.indexOf(right.league);
          if (leftIndex !== rightIndex) return leftIndex - rightIndex;
          return left.name.localeCompare(right.name);
        });

    setTeamSelectionMsg("");
    setTeamSelectionError("");
    setIsTogglingTeamId(team.id);
    setSavedTeamIds(nextSavedIds);
    setSavedTeams(nextSavedTeams);

    try {
      const teamRequestId = team.dbId || team.requestId;
      if (isSaved) {
        await apiClient.delete(`${API.USER_TEAMS}/${teamRequestId}`);
        setTeamSelectionMsg(`${team.name} removed from saved teams.`);
      } else {
        await apiClient.post(`${API.USER_TEAMS}/${teamRequestId}`);
        setTeamSelectionMsg(`${team.name} saved.`);
      }
    } catch (error: any) {
      setSavedTeamIds(previousSavedIds);
      setSavedTeams(previousSavedTeams);
      setTeamSelectionError("Could not update saved teams right now.");
    } finally {
      setIsTogglingTeamId(null);
    }
  }

  const initials = initialsFor(firstName, lastName);
  const providerLabel = formatProvider(provider, hasPassword);
  const memberSince = createdAt ? new Date(createdAt).toLocaleDateString() : "Unknown";
  const previewName = buildPreviewName(firstName, lastName);
  const focusValue =
    selectedSports.length === 0 ? "All leagues" : selectedSports.length === 1 ? selectedSports[0] : `${selectedSports.length} leagues`;
  const activeGroups = activeTeamLeague ? groupsByLeague[activeTeamLeague] || [] : [];
  const isLeagueFilterMode = activeTeamLeague === null;
  const isGroupsLoading = activeTeamLeague !== null && groupLoadingLeague === activeTeamLeague;
  const panelGroups = isLeagueFilterMode
    ? availableLeagues.map((league) => ({ name: league, teams: [], teamIds: [] }))
    : activeGroups;

  let visibleTeams = activeTeamLeague ? teamsCatalog.filter((team) => team.league === activeTeamLeague) : [...teamsCatalog];
  if (activeTeamLeague && selectedGroupNames.length > 0) {
    const allowedIds = new Set<string>();
    const allowedNames = new Set<string>();
    activeGroups
      .filter((group) => selectedGroupNames.includes(group.name))
      .forEach((group) => {
        group.teamIds.forEach((teamId) => allowedIds.add(teamId));
        group.teams.forEach((teamName) => allowedNames.add(normalizeTeamName(teamName)));
      });

    visibleTeams = visibleTeams.filter(
      (team) => allowedIds.has(team.id) || allowedNames.has(normalizeTeamName(team.name)),
    );
  }

  if (teamSearchQuery.trim()) {
    const query = teamSearchQuery.toLowerCase();
    visibleTeams = visibleTeams.filter(
      (team) => team.name.toLowerCase().includes(query) || team.shortName.toLowerCase().includes(query),
    );
  }

  visibleTeams = [...visibleTeams].sort((left, right) => {
    const leftSaved = savedTeamIds.includes(left.id);
    const rightSaved = savedTeamIds.includes(right.id);
    if (leftSaved !== rightSaved) return leftSaved ? -1 : 1;
    const leftIndex = LEAGUE_ORDER.indexOf(left.league);
    const rightIndex = LEAGUE_ORDER.indexOf(right.league);
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.name.localeCompare(right.name);
  });

  const filterTitle = getFilterTitle(activeTeamLeague);
  const filterEmptyStateText = activeTeamLeague === null ? "" : "No additional filters for this league.";

  function handleFilterToggle(groupName: string) {
    if (isLeagueFilterMode) {
      if (LEAGUE_ORDER.includes(groupName as LeagueKey)) {
        setActiveTeamLeague(groupName as LeagueKey);
        setSelectedGroupNames([]);
      }
      return;
    }

    setSelectedGroupNames((previous) =>
      previous.includes(groupName) ? previous.filter((name) => name !== groupName) : [...previous, groupName],
    );
  }

  function handleFilterClearAll() {
    if (isLeagueFilterMode) return;
    setSelectedGroupNames([]);
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(31,79,166,0.18),transparent_36%),linear-gradient(180deg,#060b16_0%,#09101d_28%,#060c17_100%)] text-foreground">
      <Navbar />

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pb-20 pt-8 md:px-6 xl:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-accent/75">Settings</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Control Room</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Tune how you show up in SportSync, keep your sports in sync, and manage the teams that shape your feed.
            </p>
          </div>
          <div className="rounded-2xl border border-[#24324d] bg-[#08111e]/75 px-4 py-3 text-right shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted/70">Member since</p>
            <p className="mt-1 text-sm font-medium text-foreground">{memberSince}</p>
          </div>
        </div>

        {loadMsg ? (
          <div className="rounded-2xl border border-[#29497b] bg-[#0b1630]/85 px-4 py-3 text-sm text-[#bfd4ff]">
            {loadMsg}
          </div>
        ) : null}

        {teamsLoadMsg ? (
          <div className="rounded-2xl border border-[#60491a] bg-[#1b1305]/85 px-4 py-3 text-sm text-[#f0d9a4]">
            {teamsLoadMsg}
          </div>
        ) : null}

        <Section
          eyebrow="Identity"
          title="How you show up in the app"
          description="This is the live preview of your account presence across the dashboard, game detail, and social touchpoints."
          accent="before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-gradient-to-b before:from-accent/0 before:via-accent/50 before:to-accent/0"
        >
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[30px] border border-[#263553] bg-[linear-gradient(180deg,rgba(10,18,31,0.88),rgba(8,14,24,0.96))] p-7">
              <div className="flex flex-col items-center justify-center text-center">
                <SafeAvatar
                  src={profilePictureUrl}
                  alt="Profile"
                  className="mb-6 flex h-40 w-40 items-center justify-center overflow-hidden rounded-[36px] border border-[#31476e] bg-[#0b1425] shadow-[0_0_0_8px_rgba(17,28,48,0.5)]"
                  imgClassName="h-full w-full object-cover"
                  loadingContent={<div className="h-full w-full animate-pulse bg-accent/10" />}
                  fallback={
                    <span className="text-4xl font-semibold tracking-[0.18em] text-accent/90">
                      {initials || "SS"}
                    </span>
                  }
                />
                <h2 className="text-4xl font-semibold tracking-tight text-foreground">{previewName}</h2>
                <p className="mt-2 text-2xl font-medium text-accent">@{displayHandle || "handle"}</p>
                <p className="mt-3 text-lg text-muted">{email || "email@example.com"}</p>
              </div>

              <div className="mt-8 grid gap-3 md:grid-cols-3">
                <InfoPill label="Security" value={providerLabel} />
                <InfoPill label="Focus" value={focusValue} />
                <InfoPill label="Saved Teams" value={`${savedTeamIds.length}`} />
              </div>

              <div className="mt-6 rounded-2xl border border-[#22314a] bg-[#08111c]/70 px-5 py-4 text-sm leading-7 text-muted">
                <p>Your display handle stays unique across the app.</p>
                <p>Avatar uploads are saved straight to your profile.</p>
                <p>Deleting the account removes saved teams and feed memory too.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-[#24314d] bg-[#08111c]/75 p-5">
                <p className="text-[11px] uppercase tracking-[0.2em] text-muted/70">Current sports</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedSports.length === 0 ? (
                    <span className="inline-flex items-center rounded-full border border-[#2d4064] bg-[#0c1628] px-3 py-2 text-xs font-semibold text-foreground">
                      All leagues (default)
                    </span>
                  ) : null}
                  {SUPPORTED_SPORTS.map((sport) => {
                    const active = selectedSports.includes(sport.id);
                    return (
                      <button
                        key={sport.id}
                        type="button"
                        onClick={() => toggleSport(sport.id)}
                        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
                          active
                            ? "border-accent bg-accent text-white shadow-[0_10px_30px_rgba(46,142,255,0.26)]"
                            : "border-[#273753] bg-[#0b1320] text-muted hover:border-[#35507e] hover:text-foreground"
                        }`}
                      >
                        {active ? <CheckIcon /> : null}
                        {sport.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted">
                  {selectedSports.length === 0
                    ? "Nothing is pinned right now. The dashboard will default to All."
                    : "Tap a league to tune what rises to the top first."}
                </p>
              </div>

              <div className="rounded-3xl border border-[#24314d] bg-[#08111c]/75 p-5">
                <p className="text-[11px] uppercase tracking-[0.2em] text-muted/70">Saved teams snapshot</p>
                {savedTeams.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {savedTeams.slice(0, 12).map((team) => (
                      <span
                        key={team.id}
                        className="inline-flex items-center gap-2 rounded-full border border-[#2d4064] bg-[#0c1628] px-3 py-2 text-xs font-semibold text-foreground"
                      >
                        <SafeAvatar
                          src={team.logo}
                          alt={team.name}
                          className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-[#101c30]"
                          imgClassName="h-full w-full object-contain"
                          fallback={<span className="text-[10px] text-accent">{team.shortName.slice(0, 2)}</span>}
                        />
                        {team.shortName}
                      </span>
                    ))}
                    {savedTeams.length > 12 ? (
                      <span className="inline-flex items-center rounded-full border border-[#273753] bg-[#0b1320] px-3 py-2 text-xs text-muted">
                        +{savedTeams.length - 12} more
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted">No saved teams yet. Pick them below and your feed will reshuffle instantly.</p>
                )}
              </div>
            </div>
          </div>
        </Section>

        <Section
          eyebrow="Identity"
          title="Profile studio"
          description="Update your name, handle, and profile image. This changes the name shown throughout the app."
          accent=""
        >
          <form className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]" onSubmit={handleProfileSave}>
            <div className="rounded-3xl border border-[#24314d] bg-[#09121f]/78 p-5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted/70">Avatar</p>
              <div className="mt-5 flex flex-col items-center gap-4">
                <SafeAvatar
                  src={profilePictureUrl}
                  alt="Profile preview"
                  className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-[28px] border border-[#304667] bg-[#0b1425]"
                  imgClassName="h-full w-full object-cover"
                  loadingContent={<div className="h-full w-full animate-pulse bg-accent/10" />}
                  fallback={<span className="text-2xl font-semibold text-accent">{initials || "SS"}</span>}
                />
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={openAvatarPicker}
                    className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-hover"
                  >
                    Upload image
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfilePictureUrl("");
                      setProfileMsg("Avatar cleared. Save profile to publish it.");
                      setProfileError("");
                    }}
                    className="rounded-full border border-[#314261] bg-[#0a1321] px-4 py-2 text-sm font-semibold text-muted transition hover:text-foreground"
                  >
                    Remove image
                  </button>
                </div>
                <p className="text-xs text-muted">PNG or JPG under 2 MB works best.</p>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarFileChange} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted/70">First name</span>
                <input
                  className={inputCls}
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  placeholder={DEFAULT_PROFILE_FIRST_NAME}
                  disabled={isLoadingProfile || isSavingProfile}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted/70">Last name</span>
                <input
                  className={inputCls}
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  placeholder={DEFAULT_PROFILE_LAST_NAME}
                  disabled={isLoadingProfile || isSavingProfile}
                />
              </label>
              <label className="block md:col-span-2">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted/70">Display handle</span>
                <input
                  className={inputCls}
                  value={displayHandle}
                  onChange={(event) => setDisplayHandle(event.target.value.replace(/\s+/g, ""))}
                  placeholder="johndoe"
                  disabled={isLoadingProfile || isSavingProfile}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted/70">Email</span>
                <div className={readOnlyCls}>{email || "No email"}</div>
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted/70">Gender</span>
                <select
                  className={inputCls}
                  value={gender || ""}
                  onChange={(event) => setGender(event.target.value)}
                  disabled={isLoadingProfile || isSavingProfile}
                >
                  <option value="">Prefer not to say</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="nonbinary">Non-binary</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <div className="md:col-span-2 flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isSavingProfile || isLoadingProfile}
                  className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingProfile ? "Saving..." : "Save profile"}
                </button>
                {profileMsg ? <p className="text-sm text-emerald-300">{profileMsg}</p> : null}
                {profileError ? <p className="text-sm text-rose-300">{profileError}</p> : null}
              </div>
            </div>
          </form>
        </Section>

        <Section
          eyebrow="Feed DNA"
          title="Sports and team promises"
          description="This is the same core preference flow from onboarding, just upgraded for settings so people can revisit it anytime."
          accent=""
        >
          <div className="space-y-6">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowFeedDNA((current) => !current)}
                className="rounded-full border border-[#304667] bg-[#09121f]/78 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted transition hover:border-[#3b5f95] hover:text-foreground"
              >
                {showFeedDNA ? "Hide setup" : "Show setup"}
              </button>
            </div>
            {showFeedDNA ? (
              <>
            <div className="rounded-3xl border border-[#24314d] bg-[#09121f]/78 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-medium text-foreground">Choose the sports that shape your dashboard.</p>
                <p className="text-xs text-muted">Leave them all off if you want the dashboard to stay on All.</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {SUPPORTED_SPORTS.map((sport) => {
                  const active = selectedSports.includes(sport.id);
                  return (
                    <button
                      key={sport.id}
                      type="button"
                      onClick={() => toggleSport(sport.id)}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition-all ${
                        active
                          ? "border-accent bg-accent text-white shadow-[0_12px_30px_rgba(46,142,255,0.22)]"
                          : "border-[#273753] bg-[#0b1320] text-muted hover:border-[#35507e] hover:text-foreground"
                      }`}
                    >
                      {active ? <CheckIcon /> : null}
                      {sport.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleFeedSetupSave()}
                  disabled={isSavingFeedSetup}
                  className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingFeedSetup ? "Saving..." : "Save dashboard setup"}
                </button>
                {feedSetupMsg ? <p className="text-sm text-emerald-300">{feedSetupMsg}</p> : null}
                {feedSetupError ? <p className="text-sm text-rose-300">{feedSetupError}</p> : null}
              </div>
            </div>

            <div className="rounded-3xl border border-[#24314d] bg-[#09121f]/78 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Pick your teams again whenever you want.</p>
                  <p className="mt-1 text-xs text-muted">Saved teams jump to the front of the feed, just like onboarding promised.</p>
                </div>
                {teamSelectionMsg ? <p className="text-sm text-emerald-300">{teamSelectionMsg}</p> : null}
                {teamSelectionError ? <p className="text-sm text-rose-300">{teamSelectionError}</p> : null}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTeamLeague(null);
                    setSelectedGroupNames([]);
                  }}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    activeTeamLeague === null
                      ? "border-accent bg-accent text-white"
                      : "border-[#273753] bg-[#0b1320] text-muted hover:border-[#35507e] hover:text-foreground"
                  }`}
                >
                  All
                </button>
                {availableLeagues.map((league) => (
                  <button
                    key={league}
                    type="button"
                    onClick={() => {
                      setActiveTeamLeague(league);
                      setSelectedGroupNames([]);
                    }}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      activeTeamLeague === league
                        ? "border-accent bg-accent text-white"
                        : "border-[#273753] bg-[#0b1320] text-muted hover:border-[#35507e] hover:text-foreground"
                    }`}
                  >
                    {league}
                  </button>
                ))}
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_300px]">
                <div className="space-y-4">
                  <label className="relative block">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted/70">
                      <SearchIcon />
                    </span>
                    <input
                      className={`${inputCls} pl-11`}
                      value={teamSearchQuery}
                      onChange={(event) => setTeamSearchQuery(event.target.value)}
                      placeholder="Search teams..."
                      disabled={isLoadingTeams}
                    />
                  </label>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {isLoadingTeams ? (
                      Array.from({ length: 6 }).map((_, index) => (
                        <div
                          key={index}
                          className="h-32 animate-pulse rounded-[24px] border border-[#22314a] bg-[#0b1423]/75"
                        />
                      ))
                    ) : visibleTeams.length > 0 ? (
                      visibleTeams.map((team) => {
                        const isSaved = savedTeamIds.includes(team.id);
                        const isBusy = isTogglingTeamId === team.id;
                        return (
                          <button
                            key={team.id}
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleTeamToggle(team)}
                            className={`group rounded-[24px] border p-4 text-left transition-all ${
                              isSaved
                                ? "border-accent bg-[linear-gradient(180deg,rgba(46,142,255,0.18),rgba(10,18,31,0.92))] shadow-[0_16px_40px_rgba(21,77,169,0.18)]"
                                : "border-[#22314a] bg-[#0b1423]/78 hover:border-[#35507e] hover:bg-[#0d1829]"
                            } ${isBusy ? "cursor-wait opacity-80" : ""}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <SafeAvatar
                                src={team.logo}
                                alt={team.name}
                                className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[18px] border border-[#283a5b] bg-[#0a1322]"
                                imgClassName="h-full w-full object-contain p-2"
                                loadingContent={<div className="h-full w-full animate-pulse bg-accent/10" />}
                                fallback={<span className="text-sm font-semibold text-accent">{team.shortName.slice(0, 2)}</span>}
                              />
                              {isSaved ? (
                                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/15 text-xs text-white">
                                  <CheckIcon />
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-4">
                              <p className="text-base font-semibold text-foreground">{team.name}</p>
                              <p className="mt-1 text-sm text-muted">{team.league}</p>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-[#22314a] bg-[#08111c]/72 px-4 py-6 text-sm text-muted">
                        No teams match this view yet. Try a different search or league.
                      </div>
                    )}
                  </div>
                </div>

                <TeamFilterPanel
                  title={filterTitle}
                  groups={panelGroups}
                  selectedGroups={selectedGroupNames}
                  emptyStateText={filterEmptyStateText}
                  isLoading={isGroupsLoading}
                  layout={isLeagueFilterMode ? "stack" : "grid"}
                  onClearAll={handleFilterClearAll}
                  onToggleGroup={handleFilterToggle}
                />
              </div>
            </div>
              </>
            ) : (
              <div className="rounded-3xl border border-[#24314d] bg-[#09121f]/78 p-5 text-sm text-muted">
                Feed setup is tucked away for now. Show it again anytime if you want to change sports or saved teams.
              </div>
            )}
          </div>
        </Section>

        <Section
          eyebrow="Security"
          title="Password and login setup"
          description="Google-first accounts can still create a password later, and email accounts can rotate it here."
          accent=""
        >
          <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-3">
              <InfoPill label="Provider" value={providerLabel} />
              <InfoPill label="Email" value={email || "No email"} />
              <InfoPill label="Password" value={hasPassword ? "Configured" : "Not set yet"} />
            </div>

            <form className="grid gap-4 md:grid-cols-2" onSubmit={handlePasswordSave}>
              {hasPassword ? (
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted/70">Current password</span>
                  <input
                    type="password"
                    className={inputCls}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    placeholder="Current password"
                    disabled={isSavingPassword}
                  />
                </label>
              ) : null}
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted/70">New password</span>
                <input
                  type="password"
                  className={inputCls}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  disabled={isSavingPassword}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted/70">Confirm password</span>
                <input
                  type="password"
                  className={inputCls}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repeat the new password"
                  disabled={isSavingPassword}
                />
              </label>

              <div className="md:col-span-2 flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isSavingPassword}
                  className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingPassword ? "Saving..." : hasPassword ? "Change password" : "Create password"}
                </button>
                {passwordMsg ? <p className="text-sm text-emerald-300">{passwordMsg}</p> : null}
                {passwordError ? <p className="text-sm text-rose-300">{passwordError}</p> : null}
              </div>
            </form>
          </div>
        </Section>

        <Section
          eyebrow="Danger"
          title="Delete account"
          description="This permanently removes your profile, saved teams, and feed memory. There is no undo."
          accent="border-rose-500/25"
        >
          <div className="rounded-3xl border border-rose-500/20 bg-[linear-gradient(180deg,rgba(47,12,17,0.62),rgba(17,8,11,0.92))] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <p className="text-base font-semibold text-foreground">Permanently delete this account</p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  If you confirm this, your saved teams, profile preferences, and account access all disappear.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDelete((current) => !current)}
                className="rounded-full border border-rose-400/35 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20"
              >
                {showDelete ? "Close" : "Open delete controls"}
              </button>
            </div>

            {showDelete ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted/70">Type DELETE</span>
                  <input
                    className={inputCls}
                    value={deleteConfirmText}
                    onChange={(event) => setDeleteConfirmText(event.target.value)}
                    placeholder="DELETE"
                    disabled={isDeletingAccount}
                  />
                </label>
                {hasPassword ? (
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted/70">Current password</span>
                    <input
                      type="password"
                      className={inputCls}
                      value={deletePassword}
                      onChange={(event) => setDeletePassword(event.target.value)}
                      placeholder="Current password"
                      disabled={isDeletingAccount}
                    />
                  </label>
                ) : (
                  <div className="rounded-2xl border border-[#2b3854] bg-[#09111c]/75 px-4 py-3 text-sm text-muted">
                    Google-only account detected. Password confirmation is not required unless you add one later.
                  </div>
                )}

                <div className="md:col-span-2 flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => void handleDeleteAccount()}
                    disabled={isDeletingAccount}
                    className="rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDeletingAccount ? "Deleting..." : "Delete account forever"}
                  </button>
                  {deleteError ? <p className="text-sm text-rose-200">{deleteError}</p> : null}
                </div>
              </div>
            ) : null}
          </div>
        </Section>
      </main>

      <Footer />
    </div>
  );
}
