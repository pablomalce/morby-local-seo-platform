/**
 * Database types — hand-written to match the SQL migration in
 * supabase/migrations/0001_init_growth_os.sql.
 *
 * Phase 3 will replace this with auto-generated types from `supabase gen types typescript`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          default_locale: string;
          default_currency: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["organizations"]["Row"]> & {
          name: string;
          slug: string;
        };
        Update: Partial<Database["public"]["Tables"]["organizations"]["Row"]>;
      };
      org_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: "owner" | "admin" | "manager" | "editor" | "viewer";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["org_members"]["Row"]> & {
          organization_id: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["org_members"]["Row"]>;
      };
      businesses: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          website: string;
          industry: string;
          brand_tone: string;
          primary_locale: string;
          value_proposition: string;
          logo_color: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["businesses"]["Row"]> & {
          organization_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["businesses"]["Row"]>;
      };
      business_locations: {
        Row: {
          id: string;
          business_id: string;
          label: string;
          address_line: string;
          city: string;
          region: string;
          country: string;
          primary_geo_query: string;
          latitude: number | null;
          longitude: number | null;
          is_primary: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["business_locations"]["Row"]> & {
          business_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["business_locations"]["Row"]>;
      };
      business_services: {
        Row: {
          id: string;
          business_id: string;
          slug: string;
          name: string;
          description: string;
          primary_keyword: string;
          supporting_keywords: string[];
          is_featured: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["business_services"]["Row"]> & {
          business_id: string;
          slug: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["business_services"]["Row"]>;
      };
      competitors: {
        Row: {
          id: string;
          business_id: string;
          location_id: string | null;
          name: string;
          website: string | null;
          rating: number | null;
          review_count: number | null;
          strength_score: number;
          relevance_score: number;
          strengths: string[];
          weaknesses: string[];
          opportunities: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["competitors"]["Row"]> & {
          business_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["competitors"]["Row"]>;
      };
      reviews: {
        Row: {
          id: string;
          business_id: string;
          location_id: string | null;
          author: string;
          rating: number;
          text: string;
          service_mentioned: string | null;
          suggested_reply: string | null;
          status: string;
          received_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["reviews"]["Row"]> & {
          business_id: string;
          author: string;
          rating: number;
          text: string;
        };
        Update: Partial<Database["public"]["Tables"]["reviews"]["Row"]>;
      };
      content_assets: {
        Row: {
          id: string;
          business_id: string;
          service_id: string | null;
          locale: string;
          kind: string;
          title: string | null;
          body: string;
          target_keyword: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["content_assets"]["Row"]> & {
          business_id: string;
          kind: string;
          body: string;
        };
        Update: Partial<Database["public"]["Tables"]["content_assets"]["Row"]>;
      };
      social_image_assets: {
        Row: {
          id: string;
          business_id: string;
          service_id: string | null;
          location_id: string | null;
          platform: string;
          aspect_ratio: string;
          visual_style: string;
          campaign_goal: string;
          audience: string;
          language: string;
          brand_tone: string;
          prompt: string;
          caption: string;
          hashtags: string[];
          alt_text: string;
          cta: string;
          image_url: string;
          provider: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["social_image_assets"]["Row"]> & {
          business_id: string;
          platform: string;
          aspect_ratio: string;
          prompt: string;
          caption: string;
          image_url: string;
        };
        Update: Partial<Database["public"]["Tables"]["social_image_assets"]["Row"]>;
      };
      campaigns: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          goal: string;
          start_date: string | null;
          end_date: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["campaigns"]["Row"]> & {
          business_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["campaigns"]["Row"]>;
      };
      platform_tasks: {
        Row: {
          id: string;
          business_id: string;
          title: string;
          description: string | null;
          category: string;
          priority: string;
          impact: string;
          difficulty: string;
          week: number | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["platform_tasks"]["Row"]> & {
          business_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["platform_tasks"]["Row"]>;
      };
      reports: {
        Row: {
          id: string;
          business_id: string;
          title: string;
          kind: string;
          locale: string;
          summary: string;
          content: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["reports"]["Row"]> & {
          business_id: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["reports"]["Row"]>;
      };
      agent_runs: {
        Row: {
          id: string;
          business_id: string | null;
          agent_id: string;
          scope: string;
          scope_id: string;
          status: string;
          input: Json;
          output: string | null;
          error: string | null;
          tokens_used: number | null;
          cost_usd: number | null;
          started_at: string;
          finished_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["agent_runs"]["Row"]> & {
          agent_id: string;
          scope: string;
          scope_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["agent_runs"]["Row"]>;
      };
      activity_logs: {
        Row: {
          id: string;
          actor_id: string | null;
          organization_id: string | null;
          scope: string;
          scope_id: string;
          action: string;
          payload: Json;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["activity_logs"]["Row"]> & {
          scope: string;
          scope_id: string;
          action: string;
        };
        Update: Partial<Database["public"]["Tables"]["activity_logs"]["Row"]>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_user_org_ids: { Args: Record<string, never>; Returns: string[] };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
