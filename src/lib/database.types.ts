/** Auto-generated Supabase database types. Keep in sync with schema. */

export type GamePhase = "setup" | "playing" | "ended";
export type PlayerRole = "hider" | "seeker";

export interface Database {
    public: {
        Tables: {
            games: {
                Row: {
                    id: string;
                    room_code: string;
                    phase: GamePhase;
                    host_id: string;
                    hiding_radius: number | null;
                    hiding_radius_units: string | null;
                    display_hiding_zones_options: string[] | null;
                    created_at: string;
                    expires_at: string;
                };
                Insert: {
                    id?: string;
                    room_code: string;
                    phase?: GamePhase;
                    host_id: string;
                    hiding_radius?: number | null;
                    hiding_radius_units?: string | null;
                    display_hiding_zones_options?: string[] | null;
                    created_at?: string;
                    expires_at?: string;
                };
                Update: Partial<Database["public"]["Tables"]["games"]["Insert"]>;
            };
            game_geo_data: {
                Row: {
                    game_id: string;
                    map_geo_location: Record<string, unknown> | null;
                    poly_geo_json: Record<string, unknown> | null;
                    custom_stations: Record<string, unknown> | null;
                    permanent_overlay: Record<string, unknown> | null;
                };
                Insert: {
                    game_id: string;
                    map_geo_location?: Record<string, unknown> | null;
                    poly_geo_json?: Record<string, unknown> | null;
                    custom_stations?: Record<string, unknown> | null;
                    permanent_overlay?: Record<string, unknown> | null;
                };
                Update: Partial<
                    Database["public"]["Tables"]["game_geo_data"]["Insert"]
                >;
            };
            players: {
                Row: {
                    id: string;
                    user_id: string;
                    game_id: string;
                    display_name: string;
                    role: PlayerRole;
                    joined_at: string;
                };
                Insert: {
                    id?: string;
                    user_id: string;
                    game_id: string;
                    display_name: string;
                    role: PlayerRole;
                    joined_at?: string;
                };
                Update: Partial<
                    Database["public"]["Tables"]["players"]["Insert"]
                >;
            };
            hider_location: {
                Row: {
                    game_id: string;
                    lat: number | null;
                    lng: number | null;
                    set_by: string | null;
                    confirmed: boolean;
                    updated_at: string;
                };
                Insert: {
                    game_id: string;
                    lat?: number | null;
                    lng?: number | null;
                    set_by?: string | null;
                    confirmed?: boolean;
                    updated_at?: string;
                };
                Update: Partial<
                    Database["public"]["Tables"]["hider_location"]["Insert"]
                >;
            };
            questions: {
                Row: {
                    id: string;
                    game_id: string;
                    question_order: number;
                    asked_by: string;
                    question_type: string;
                    question_data: Record<string, unknown>;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    game_id: string;
                    question_order?: number;
                    asked_by: string;
                    question_type: string;
                    question_data: Record<string, unknown>;
                    created_at?: string;
                };
                Update: Partial<
                    Database["public"]["Tables"]["questions"]["Insert"]
                >;
            };
            answers: {
                Row: {
                    id: string;
                    question_id: string;
                    game_id: string;
                    answered_by: string;
                    answer_data: Record<string, unknown>;
                    answered_at: string;
                    undo_deadline: string;
                };
                Insert: {
                    id?: string;
                    question_id: string;
                    game_id: string;
                    answered_by: string;
                    answer_data: Record<string, unknown>;
                    answered_at?: string;
                    undo_deadline?: string;
                };
                Update: Partial<
                    Database["public"]["Tables"]["answers"]["Insert"]
                >;
            };
        };
        Functions: {
            generate_room_code: {
                Args: Record<string, never>;
                Returns: string;
            };
        };
    };
}
