// supabase/schema.sql 과 1:1로 맞춘 수동 타입 정의.
// 나중에 실제 프로젝트를 연결한 뒤 `supabase gen types typescript` 로 자동 생성본으로 교체해도 된다.

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; nickname: string; created_at: string };
        Insert: { id: string; nickname: string; created_at?: string };
        Update: { id?: string; nickname?: string; created_at?: string };
        Relationships: [];
      };
      characters: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          server: string | null;
          class: string | null;
          item_level: number | null;
          combat_power: number | null;
          class_engraving: string | null;
          is_gold_earner: boolean;
          expedition_label: string | null;
          is_main_character: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          server?: string | null;
          class?: string | null;
          item_level?: number | null;
          combat_power?: number | null;
          class_engraving?: string | null;
          is_gold_earner?: boolean;
          expedition_label?: string | null;
          is_main_character?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["characters"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "characters_owner_id_fkey";
            columns: ["owner_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      raids: {
        Row: {
          id: string;
          name: string;
          difficulty: string;
          min_item_level: number;
          gate_count: number;
          gold_per_gate: number[];
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          difficulty: string;
          min_item_level?: number;
          gate_count?: number;
          gold_per_gate?: number[];
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["raids"]["Insert"]>;
        Relationships: [];
      };
      raid_clear_templates: {
        Row: {
          id: string;
          raid_id: string | null;
          template_type: string;
          crop: { xPct: number; yPct: number; wPct: number; hPct: number } | null;
          raid_label: string | null;
          badge_crop: { xPct: number; yPct: number; wPct: number; hPct: number } | null;
          character_id: string | null;
          storage_path: string;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          raid_id?: string | null;
          template_type?: string;
          crop?: { xPct: number; yPct: number; wPct: number; hPct: number } | null;
          raid_label?: string | null;
          badge_crop?: { xPct: number; yPct: number; wPct: number; hPct: number } | null;
          character_id?: string | null;
          storage_path: string;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["raid_clear_templates"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "raid_clear_templates_raid_id_fkey";
            columns: ["raid_id"];
            referencedRelation: "raids";
            referencedColumns: ["id"];
          },
        ];
      };
      character_raids: {
        Row: {
          id: string;
          character_id: string;
          raid_id: string;
          is_gold_earning: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          character_id: string;
          raid_id: string;
          is_gold_earning?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["character_raids"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "character_raids_character_id_fkey";
            columns: ["character_id"];
            referencedRelation: "characters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "character_raids_raid_id_fkey";
            columns: ["raid_id"];
            referencedRelation: "raids";
            referencedColumns: ["id"];
          },
        ];
      };
      weekly_checks: {
        Row: {
          id: string;
          character_id: string;
          raid_id: string;
          gate_number: number;
          week_key: string;
          checked_by: string;
          checked_at: string;
        };
        Insert: {
          id?: string;
          character_id: string;
          raid_id: string;
          gate_number: number;
          week_key: string;
          checked_by: string;
          checked_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["weekly_checks"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "weekly_checks_character_id_fkey";
            columns: ["character_id"];
            referencedRelation: "characters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "weekly_checks_raid_id_fkey";
            columns: ["raid_id"];
            referencedRelation: "raids";
            referencedColumns: ["id"];
          },
        ];
      };
      market_item_prices: {
        Row: {
          item_id: number;
          item_name: string;
          current_min_price: number;
          bundle_count: number;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          item_id: number;
          item_name: string;
          current_min_price: number;
          bundle_count: number;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["market_item_prices"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Character = Database["public"]["Tables"]["characters"]["Row"];
export type Raid = Database["public"]["Tables"]["raids"]["Row"];
export type CharacterRaid = Database["public"]["Tables"]["character_raids"]["Row"];
export type RaidClearTemplate = Database["public"]["Tables"]["raid_clear_templates"]["Row"];
export type WeeklyCheck = Database["public"]["Tables"]["weekly_checks"]["Row"];
