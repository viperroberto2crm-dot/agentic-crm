export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agent_actions: {
        Row: {
          id: string
          run_id: string | null
          action_type: string
          reasoning: string | null
          payload: Json
          executed: boolean
          executed_at: string | null
          error: string | null
          created_at: string
        }
        Insert: {
          id?: string
          run_id?: string | null
          action_type: string
          reasoning?: string | null
          payload?: Json
          executed?: boolean
          executed_at?: string | null
          error?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          run_id?: string | null
          action_type?: string
          reasoning?: string | null
          payload?: Json
          executed?: boolean
          executed_at?: string | null
          error?: string | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "agent_actions_run_id_fkey"; columns: ["run_id"]; referencedRelation: "agent_runs"; referencedColumns: ["id"] }
        ]
      }
      agent_compactions: {
        Row: {
          id: string
          user_id: string
          brand_id: string | null
          summary: string
          up_to_run_id: string | null
          tokens_input: number | null
          tokens_output: number | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          brand_id?: string | null
          summary: string
          up_to_run_id?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          brand_id?: string | null
          summary?: string
          up_to_run_id?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "agent_compactions_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "agent_compactions_up_to_run_id_fkey"; columns: ["up_to_run_id"]; referencedRelation: "agent_runs"; referencedColumns: ["id"] }
        ]
      }
      agent_goals: {
        Row: {
          id: string
          brand_id: string | null
          name: string
          description: string
          evaluation_spec: Json
          evaluation_frequency: string
          active: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          brand_id?: string | null
          name: string
          description: string
          evaluation_spec: Json
          evaluation_frequency: string
          active?: boolean
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          brand_id?: string | null
          name?: string
          description?: string
          evaluation_spec?: Json
          evaluation_frequency?: string
          active?: boolean
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "agent_goals_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "agent_goals_created_by_fkey"; columns: ["created_by"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      agent_pending_actions: {
        Row: {
          id: string
          agent_run_id: string | null
          brand_id: string | null
          action_type: string
          payload: Json
          reasoning: string | null
          related_user_id: string | null
          related_lead_id: string | null
          status: string
          approval_required_role: string
          approved_by: string | null
          approved_at: string | null
          rejected_reason: string | null
          expires_at: string | null
          executed_at: string | null
          execution_result: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          agent_run_id?: string | null
          brand_id?: string | null
          action_type: string
          payload: Json
          reasoning?: string | null
          related_user_id?: string | null
          related_lead_id?: string | null
          status?: string
          approval_required_role: string
          approved_by?: string | null
          approved_at?: string | null
          rejected_reason?: string | null
          expires_at?: string | null
          executed_at?: string | null
          execution_result?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          agent_run_id?: string | null
          brand_id?: string | null
          action_type?: string
          payload?: Json
          reasoning?: string | null
          related_user_id?: string | null
          related_lead_id?: string | null
          status?: string
          approval_required_role?: string
          approved_by?: string | null
          approved_at?: string | null
          rejected_reason?: string | null
          expires_at?: string | null
          executed_at?: string | null
          execution_result?: Json | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "agent_pending_actions_agent_run_id_fkey"; columns: ["agent_run_id"]; referencedRelation: "agent_runs"; referencedColumns: ["id"] },
          { foreignKeyName: "agent_pending_actions_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "agent_pending_actions_related_lead_id_fkey"; columns: ["related_lead_id"]; referencedRelation: "leads"; referencedColumns: ["id"] },
          { foreignKeyName: "agent_pending_actions_related_user_id_fkey"; columns: ["related_user_id"]; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "agent_pending_actions_approved_by_fkey"; columns: ["approved_by"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      agent_policies: {
        Row: {
          id: string
          brand_id: string | null
          scope_user_id: string | null
          action_type: string
          autonomy: string
          conditions: Json | null
          active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          brand_id?: string | null
          scope_user_id?: string | null
          action_type: string
          autonomy: string
          conditions?: Json | null
          active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          brand_id?: string | null
          scope_user_id?: string | null
          action_type?: string
          autonomy?: string
          conditions?: Json | null
          active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "agent_policies_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "agent_policies_scope_user_id_fkey"; columns: ["scope_user_id"]; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "agent_policies_created_by_fkey"; columns: ["created_by"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      agent_runs: {
        Row: {
          id: string
          run_type: string
          triggered_by: string | null
          related_user_id: string | null
          input_summary: string | null
          output_summary: string | null
          tokens_in: number | null
          tokens_out: number | null
          cost_cents: number | null
          duration_ms: number | null
          error: string | null
          brand_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          run_type: string
          triggered_by?: string | null
          related_user_id?: string | null
          input_summary?: string | null
          output_summary?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          cost_cents?: number | null
          duration_ms?: number | null
          error?: string | null
          brand_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          run_type?: string
          triggered_by?: string | null
          related_user_id?: string | null
          input_summary?: string | null
          output_summary?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          cost_cents?: number | null
          duration_ms?: number | null
          error?: string | null
          brand_id?: string | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "agent_runs_related_user_id_fkey"; columns: ["related_user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
          , { foreignKeyName: "agent_runs_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] }
        ]
      }
      agent_skills: {
        Row: {
          id: string
          brand_id: string | null
          name: string
          version: number
          category: string
          trigger_spec: Json
          procedure_md: string
          embedding: string | null
          status: string
          evidence_count: number
          effectiveness_score: number | null
          baseline_score: number | null
          promoted_at: string | null
          promoted_by: string | null
          deprecated_at: string | null
          deprecation_reason: string | null
          source: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          brand_id?: string | null
          name: string
          version?: number
          category: string
          trigger_spec: Json
          procedure_md: string
          embedding?: string | null
          status?: string
          evidence_count?: number
          effectiveness_score?: number | null
          baseline_score?: number | null
          promoted_at?: string | null
          promoted_by?: string | null
          deprecated_at?: string | null
          deprecation_reason?: string | null
          source: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          brand_id?: string | null
          name?: string
          version?: number
          category?: string
          trigger_spec?: Json
          procedure_md?: string
          embedding?: string | null
          status?: string
          evidence_count?: number
          effectiveness_score?: number | null
          baseline_score?: number | null
          promoted_at?: string | null
          promoted_by?: string | null
          deprecated_at?: string | null
          deprecation_reason?: string | null
          source?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "agent_skills_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "agent_skills_created_by_fkey"; columns: ["created_by"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      appointments: {
        Row: {
          id: string
          brand_id: string
          lead_id: string
          rep_id: string
          type: Database["public"]["Enums"]["appointment_type"]
          status: Database["public"]["Enums"]["appointment_status"]
          clinic_id: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          state: string | null
          zip: string | null
          telehealth_link: string | null
          service: string | null
          scheduled_at: string
          duration_minutes: number
          notes: string | null
          reminder_sent_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          brand_id: string
          lead_id: string
          rep_id: string
          type: Database["public"]["Enums"]["appointment_type"]
          status?: Database["public"]["Enums"]["appointment_status"]
          clinic_id?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          telehealth_link?: string | null
          service?: string | null
          scheduled_at: string
          duration_minutes?: number
          notes?: string | null
          reminder_sent_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          brand_id?: string
          lead_id?: string
          rep_id?: string
          type?: Database["public"]["Enums"]["appointment_type"]
          status?: Database["public"]["Enums"]["appointment_status"]
          clinic_id?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          telehealth_link?: string | null
          service?: string | null
          scheduled_at?: string
          duration_minutes?: number
          notes?: string | null
          reminder_sent_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "appointments_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "appointments_clinic_id_fkey"; columns: ["clinic_id"]; referencedRelation: "clinics"; referencedColumns: ["id"] },
          { foreignKeyName: "appointments_lead_id_fkey"; columns: ["lead_id"]; referencedRelation: "leads"; referencedColumns: ["id"] },
          { foreignKeyName: "appointments_rep_id_fkey"; columns: ["rep_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      bot_agents: {
        Row: {
          id: string
          name: string
          brand_id: string | null
          voice_provider: string | null
          voice_id: string | null
          llm_model: string
          system_prompt: string
          policies: Json | null
          active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          brand_id?: string | null
          voice_provider?: string | null
          voice_id?: string | null
          llm_model: string
          system_prompt: string
          policies?: Json | null
          active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          brand_id?: string | null
          voice_provider?: string | null
          voice_id?: string | null
          llm_model?: string
          system_prompt?: string
          policies?: Json | null
          active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "bot_agents_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "bot_agents_created_by_fkey"; columns: ["created_by"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      bot_calls: {
        Row: {
          id: string
          call_id: string
          bot_agent_id: string
          handoff_to_human_at: string | null
          handoff_reason: string | null
          human_user_id: string | null
          bot_decisions: Json | null
          skills_used: string
          cost_cents: number | null
          created_at: string
        }
        Insert: {
          id?: string
          call_id: string
          bot_agent_id: string
          handoff_to_human_at?: string | null
          handoff_reason?: string | null
          human_user_id?: string | null
          bot_decisions?: Json | null
          skills_used?: string
          cost_cents?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          call_id?: string
          bot_agent_id?: string
          handoff_to_human_at?: string | null
          handoff_reason?: string | null
          human_user_id?: string | null
          bot_decisions?: Json | null
          skills_used?: string
          cost_cents?: number | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "bot_calls_bot_agent_id_fkey"; columns: ["bot_agent_id"]; referencedRelation: "bot_agents"; referencedColumns: ["id"] },
          { foreignKeyName: "bot_calls_call_id_fkey"; columns: ["call_id"]; referencedRelation: "calls"; referencedColumns: ["id"] },
          { foreignKeyName: "bot_calls_human_user_id_fkey"; columns: ["human_user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      brands: {
        Row: {
          id: string
          slug: string
          name: string
          brand_color: string | null
          logo_url: string | null
          reply_email: string | null
          whatsapp_number: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          brand_color?: string | null
          logo_url?: string | null
          reply_email?: string | null
          whatsapp_number?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          brand_color?: string | null
          logo_url?: string | null
          reply_email?: string | null
          whatsapp_number?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      call_embeddings: {
        Row: {
          id: string
          call_id: string
          source: string
          content: string
          embedding: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          call_id: string
          source: string
          content: string
          embedding?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          call_id?: string
          source?: string
          content?: string
          embedding?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "call_embeddings_call_id_fkey"; columns: ["call_id"]; referencedRelation: "calls"; referencedColumns: ["id"] }
        ]
      }
      calls: {
        Row: {
          id: string
          brand_id: string
          lead_id: string | null
          rep_id: string
          direction: Database["public"]["Enums"]["call_direction"]
          outcome: Database["public"]["Enums"]["call_outcome"] | null
          duration_seconds: number | null
          notes: string | null
          source: string
          external_id: string | null
          recording_url: string | null
          transcript_text: string | null
          ai_summary: string | null
          ai_extracted: Json | null
          called_at: string
          created_at: string
        }
        Insert: {
          id?: string
          brand_id: string
          lead_id?: string | null
          rep_id: string
          direction?: Database["public"]["Enums"]["call_direction"]
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          duration_seconds?: number | null
          notes?: string | null
          source?: string
          external_id?: string | null
          recording_url?: string | null
          transcript_text?: string | null
          ai_summary?: string | null
          ai_extracted?: Json | null
          called_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          brand_id?: string
          lead_id?: string | null
          rep_id?: string
          direction?: Database["public"]["Enums"]["call_direction"]
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          duration_seconds?: number | null
          notes?: string | null
          source?: string
          external_id?: string | null
          recording_url?: string | null
          transcript_text?: string | null
          ai_summary?: string | null
          ai_extracted?: Json | null
          called_at?: string
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "calls_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "calls_lead_id_fkey"; columns: ["lead_id"]; referencedRelation: "leads"; referencedColumns: ["id"] },
          { foreignKeyName: "calls_rep_id_fkey"; columns: ["rep_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      clinics: {
        Row: {
          id: string
          brand_id: string
          name: string
          address_line1: string | null
          address_line2: string | null
          city: string | null
          state: string | null
          zip: string | null
          phone: string | null
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          brand_id: string
          name: string
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          phone?: string | null
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          brand_id?: string
          name?: string
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          phone?: string | null
          active?: boolean
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "clinics_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] }
        ]
      }
      goals: {
        Row: {
          id: string
          rep_id: string
          brand_id: string | null
          period: string
          metric: string
          target_value: number
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          rep_id: string
          brand_id?: string | null
          period: string
          metric: string
          target_value: number
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          rep_id?: string
          brand_id?: string | null
          period?: string
          metric?: string
          target_value?: number
          active?: boolean
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "goals_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "goals_rep_id_fkey"; columns: ["rep_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      knowledge_patterns: {
        Row: {
          id: string
          brand_id: string | null
          type: string
          category: string | null
          title: string
          content: string
          embedding: string | null
          effectiveness_score: number | null
          evidence_count: number
          example_call_ids: string
          source: string
          created_by: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          brand_id?: string | null
          type: string
          category?: string | null
          title: string
          content: string
          embedding?: string | null
          effectiveness_score?: number | null
          evidence_count?: number
          example_call_ids?: string
          source: string
          created_by?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          brand_id?: string | null
          type?: string
          category?: string | null
          title?: string
          content?: string
          embedding?: string | null
          effectiveness_score?: number | null
          evidence_count?: number
          example_call_ids?: string
          source?: string
          created_by?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "knowledge_patterns_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "knowledge_patterns_created_by_fkey"; columns: ["created_by"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      lead_assignments: {
        Row: {
          id: string
          lead_id: string
          from_rep_id: string | null
          to_rep_id: string | null
          assigned_by: string | null
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          from_rep_id?: string | null
          to_rep_id?: string | null
          assigned_by?: string | null
          reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          from_rep_id?: string | null
          to_rep_id?: string | null
          assigned_by?: string | null
          reason?: string | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "lead_assignments_assigned_by_fkey"; columns: ["assigned_by"]; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "lead_assignments_from_rep_id_fkey"; columns: ["from_rep_id"]; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "lead_assignments_lead_id_fkey"; columns: ["lead_id"]; referencedRelation: "leads"; referencedColumns: ["id"] },
          { foreignKeyName: "lead_assignments_to_rep_id_fkey"; columns: ["to_rep_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      leads: {
        Row: {
          id: string
          brand_id: string
          first_name: string
          last_name: string | null
          phone: string
          phone_alt: string | null
          email: string | null
          status: Database["public"]["Enums"]["lead_status"]
          source: Database["public"]["Enums"]["lead_source"] | null
          assigned_rep_id: string | null
          notes: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          state: string | null
          zip: string | null
          custom_fields: Json
          ai_score: number | null
          ai_score_reason: string | null
          last_contacted_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          brand_id: string
          first_name: string
          last_name?: string | null
          phone: string
          phone_alt?: string | null
          email?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          source?: Database["public"]["Enums"]["lead_source"] | null
          assigned_rep_id?: string | null
          notes?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          custom_fields?: Json
          ai_score?: number | null
          ai_score_reason?: string | null
          last_contacted_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          brand_id?: string
          first_name?: string
          last_name?: string | null
          phone?: string
          phone_alt?: string | null
          email?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          source?: Database["public"]["Enums"]["lead_source"] | null
          assigned_rep_id?: string | null
          notes?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          custom_fields?: Json
          ai_score?: number | null
          ai_score_reason?: string | null
          last_contacted_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "leads_assigned_rep_id_fkey"; columns: ["assigned_rep_id"]; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "leads_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "leads_created_by_fkey"; columns: ["created_by"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      notification_prefs: {
        Row: {
          user_id: string
          email_enabled: boolean
          whatsapp_enabled: boolean
          in_app_enabled: boolean
          daily_summary_enabled: boolean
          daily_summary_time: string
          reactive_alerts_enabled: boolean
          timezone: string
        }
        Insert: {
          user_id: string
          email_enabled?: boolean
          whatsapp_enabled?: boolean
          in_app_enabled?: boolean
          daily_summary_enabled?: boolean
          daily_summary_time?: string
          reactive_alerts_enabled?: boolean
          timezone?: string
        }
        Update: {
          user_id?: string
          email_enabled?: boolean
          whatsapp_enabled?: boolean
          in_app_enabled?: boolean
          daily_summary_enabled?: boolean
          daily_summary_time?: string
          reactive_alerts_enabled?: boolean
          timezone?: string
        }
        Relationships: [
          { foreignKeyName: "notification_prefs_user_id_fkey"; columns: ["user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          channel: string
          type: string
          subject: string | null
          body: string
          related_lead_id: string | null
          related_call_id: string | null
          related_appointment_id: string | null
          related_sale_id: string | null
          read_at: string | null
          sent_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          channel: string
          type: string
          subject?: string | null
          body: string
          related_lead_id?: string | null
          related_call_id?: string | null
          related_appointment_id?: string | null
          related_sale_id?: string | null
          read_at?: string | null
          sent_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          channel?: string
          type?: string
          subject?: string | null
          body?: string
          related_lead_id?: string | null
          related_call_id?: string | null
          related_appointment_id?: string | null
          related_sale_id?: string | null
          read_at?: string | null
          sent_at?: string
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "notifications_related_appointment_id_fkey"; columns: ["related_appointment_id"]; referencedRelation: "appointments"; referencedColumns: ["id"] },
          { foreignKeyName: "notifications_related_call_id_fkey"; columns: ["related_call_id"]; referencedRelation: "calls"; referencedColumns: ["id"] },
          { foreignKeyName: "notifications_related_lead_id_fkey"; columns: ["related_lead_id"]; referencedRelation: "leads"; referencedColumns: ["id"] },
          { foreignKeyName: "notifications_related_sale_id_fkey"; columns: ["related_sale_id"]; referencedRelation: "sales"; referencedColumns: ["id"] },
          { foreignKeyName: "notifications_user_id_fkey"; columns: ["user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      products: {
        Row: {
          id: string
          brand_id: string | null
          name: string
          description: string | null
          category: string
          sku: string | null
          price_cents: number
          display_price_cents: number | null
          display_unit: string | null
          cadence: string
          billing_cycle_days: number | null
          recurring: boolean
          included_services: Json
          best_value: boolean
          active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          brand_id?: string | null
          name: string
          description?: string | null
          category: string
          sku?: string | null
          price_cents: number
          display_price_cents?: number | null
          display_unit?: string | null
          cadence: string
          billing_cycle_days?: number | null
          recurring?: boolean
          included_services?: Json
          best_value?: boolean
          active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          brand_id?: string | null
          name?: string
          description?: string | null
          category?: string
          sku?: string | null
          price_cents?: number
          display_price_cents?: number | null
          display_unit?: string | null
          cadence?: string
          billing_cycle_days?: number | null
          recurring?: boolean
          included_services?: Json
          best_value?: boolean
          active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "products_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] }
        ]
      }
      sale_items: {
        Row: {
          id: string
          sale_id: string
          product_id: string | null
          product_name: string
          product_category: string
          cadence: string
          quantity: number
          unit_price_cents: number
          discount_cents: number
          line_total_cents: number
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          sale_id: string
          product_id?: string | null
          product_name: string
          product_category: string
          cadence: string
          quantity?: number
          unit_price_cents: number
          discount_cents?: number
          line_total_cents: number
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          sale_id?: string
          product_id?: string | null
          product_name?: string
          product_category?: string
          cadence?: string
          quantity?: number
          unit_price_cents?: number
          discount_cents?: number
          line_total_cents?: number
          notes?: string | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "sale_items_product_id_fkey"; columns: ["product_id"]; referencedRelation: "products"; referencedColumns: ["id"] },
          { foreignKeyName: "sale_items_sale_id_fkey"; columns: ["sale_id"]; referencedRelation: "sales"; referencedColumns: ["id"] }
        ]
      }
      sales: {
        Row: {
          id: string
          brand_id: string
          lead_id: string
          rep_id: string
          appointment_id: string | null
          amount_cents: number
          currency: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          card_last4: string | null
          card_authorization_code: string | null
          stripe_payment_intent_id: string | null
          stripe_checkout_session_id: string | null
          product: string | null
          notes: string | null
          paid_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          brand_id: string
          lead_id: string
          rep_id: string
          appointment_id?: string | null
          amount_cents: number
          currency?: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          card_last4?: string | null
          card_authorization_code?: string | null
          stripe_payment_intent_id?: string | null
          stripe_checkout_session_id?: string | null
          product?: string | null
          notes?: string | null
          paid_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          brand_id?: string
          lead_id?: string
          rep_id?: string
          appointment_id?: string | null
          amount_cents?: number
          currency?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          card_last4?: string | null
          card_authorization_code?: string | null
          stripe_payment_intent_id?: string | null
          stripe_checkout_session_id?: string | null
          product?: string | null
          notes?: string | null
          paid_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "sales_appointment_id_fkey"; columns: ["appointment_id"]; referencedRelation: "appointments"; referencedColumns: ["id"] },
          { foreignKeyName: "sales_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "sales_lead_id_fkey"; columns: ["lead_id"]; referencedRelation: "leads"; referencedColumns: ["id"] },
          { foreignKeyName: "sales_rep_id_fkey"; columns: ["rep_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      self_reflection_runs: {
        Row: {
          id: string
          period_start: string
          period_end: string
          patterns_detected: Json | null
          skills_proposed: string
          skills_promoted: string
          skills_deprecated: string
          total_calls_analyzed: number
          total_outcomes_analyzed: number
          notes: string | null
          cost_cents: number | null
          duration_ms: number | null
          created_at: string
        }
        Insert: {
          id?: string
          period_start: string
          period_end: string
          patterns_detected?: Json | null
          skills_proposed?: string
          skills_promoted?: string
          skills_deprecated?: string
          total_calls_analyzed?: number
          total_outcomes_analyzed?: number
          notes?: string | null
          cost_cents?: number | null
          duration_ms?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          period_start?: string
          period_end?: string
          patterns_detected?: Json | null
          skills_proposed?: string
          skills_promoted?: string
          skills_deprecated?: string
          total_calls_analyzed?: number
          total_outcomes_analyzed?: number
          notes?: string | null
          cost_cents?: number | null
          duration_ms?: number | null
          created_at?: string
        }
        Relationships: []
      }
      skill_applications: {
        Row: {
          id: string
          skill_id: string
          related_lead_id: string | null
          related_call_id: string | null
          related_action_id: string | null
          applied_at: string
          outcome: Json | null
          outcome_measured_at: string | null
        }
        Insert: {
          id?: string
          skill_id: string
          related_lead_id?: string | null
          related_call_id?: string | null
          related_action_id?: string | null
          applied_at?: string
          outcome?: Json | null
          outcome_measured_at?: string | null
        }
        Update: {
          id?: string
          skill_id?: string
          related_lead_id?: string | null
          related_call_id?: string | null
          related_action_id?: string | null
          applied_at?: string
          outcome?: Json | null
          outcome_measured_at?: string | null
        }
        Relationships: [
          { foreignKeyName: "skill_applications_related_action_id_fkey"; columns: ["related_action_id"]; referencedRelation: "agent_pending_actions"; referencedColumns: ["id"] },
          { foreignKeyName: "skill_applications_related_call_id_fkey"; columns: ["related_call_id"]; referencedRelation: "calls"; referencedColumns: ["id"] },
          { foreignKeyName: "skill_applications_related_lead_id_fkey"; columns: ["related_lead_id"]; referencedRelation: "leads"; referencedColumns: ["id"] },
          { foreignKeyName: "skill_applications_skill_id_fkey"; columns: ["skill_id"]; referencedRelation: "agent_skills"; referencedColumns: ["id"] }
        ]
      }
      subscriptions: {
        Row: {
          id: string
          brand_id: string
          lead_id: string
          product_id: string | null
          initial_sale_id: string | null
          cadence: string
          billing_cycle_days: number
          amount_cents: number
          status: string
          started_at: string
          next_billing_at: string
          cancelled_at: string | null
          cancelled_reason: string | null
          stripe_subscription_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          brand_id: string
          lead_id: string
          product_id?: string | null
          initial_sale_id?: string | null
          cadence: string
          billing_cycle_days: number
          amount_cents: number
          status?: string
          started_at?: string
          next_billing_at: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          stripe_subscription_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          brand_id?: string
          lead_id?: string
          product_id?: string | null
          initial_sale_id?: string | null
          cadence?: string
          billing_cycle_days?: number
          amount_cents?: number
          status?: string
          started_at?: string
          next_billing_at?: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          stripe_subscription_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "subscriptions_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "subscriptions_initial_sale_id_fkey"; columns: ["initial_sale_id"]; referencedRelation: "sales"; referencedColumns: ["id"] },
          { foreignKeyName: "subscriptions_lead_id_fkey"; columns: ["lead_id"]; referencedRelation: "leads"; referencedColumns: ["id"] },
          { foreignKeyName: "subscriptions_product_id_fkey"; columns: ["product_id"]; referencedRelation: "products"; referencedColumns: ["id"] }
        ]
      }
      tasks: {
        Row: {
          id: string
          brand_id: string | null
          assigned_to: string | null
          related_lead_id: string | null
          title: string
          description: string | null
          due_at: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          source: string
          agent_action_id: string | null
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          brand_id?: string | null
          assigned_to?: string | null
          related_lead_id?: string | null
          title: string
          description?: string | null
          due_at?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          source?: string
          agent_action_id?: string | null
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          brand_id?: string | null
          assigned_to?: string | null
          related_lead_id?: string | null
          title?: string
          description?: string | null
          due_at?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          source?: string
          agent_action_id?: string | null
          created_at?: string
          completed_at?: string | null
        }
        Relationships: [
          { foreignKeyName: "tasks_agent_action_id_fkey"; columns: ["agent_action_id"]; referencedRelation: "agent_actions"; referencedColumns: ["id"] },
          { foreignKeyName: "tasks_assigned_to_fkey"; columns: ["assigned_to"]; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "tasks_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "tasks_related_lead_id_fkey"; columns: ["related_lead_id"]; referencedRelation: "leads"; referencedColumns: ["id"] }
        ]
      }
      payment_plans: {
        Row: {
          id: string
          lead_id: string
          brand_id: string
          product_name: string
          total_amount_cents: number
          notes: string | null
          installment_count: number | null
          installment_amount_cents: number | null
          frequency_days: number | null
          first_due_date: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          brand_id: string
          product_name: string
          total_amount_cents: number
          notes?: string | null
          installment_count?: number | null
          installment_amount_cents?: number | null
          frequency_days?: number | null
          first_due_date?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          brand_id?: string
          product_name?: string
          total_amount_cents?: number
          notes?: string | null
          installment_count?: number | null
          installment_amount_cents?: number | null
          frequency_days?: number | null
          first_due_date?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "payment_plans_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "payment_plans_lead_id_fkey"; columns: ["lead_id"]; referencedRelation: "leads"; referencedColumns: ["id"] },
          { foreignKeyName: "payment_plans_created_by_fkey"; columns: ["created_by"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      abonos: {
        Row: {
          id: string
          plan_id: string
          lead_id: string
          brand_id: string
          amount_cents: number
          paid_at: string
          payment_method: string
          notes: string | null
          recorded_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          plan_id: string
          lead_id: string
          brand_id: string
          amount_cents: number
          paid_at: string
          payment_method: string
          notes?: string | null
          recorded_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          plan_id?: string
          lead_id?: string
          brand_id?: string
          amount_cents?: number
          paid_at?: string
          payment_method?: string
          notes?: string | null
          recorded_by?: string | null
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "abonos_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "abonos_lead_id_fkey"; columns: ["lead_id"]; referencedRelation: "leads"; referencedColumns: ["id"] },
          { foreignKeyName: "abonos_plan_id_fkey"; columns: ["plan_id"]; referencedRelation: "payment_plans"; referencedColumns: ["id"] },
          { foreignKeyName: "abonos_recorded_by_fkey"; columns: ["recorded_by"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      user_brands: {
        Row: {
          user_id: string
          brand_id: string
          created_at: string
        }
        Insert: {
          user_id: string
          brand_id: string
          created_at?: string
        }
        Update: {
          user_id?: string
          brand_id?: string
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "user_brands_brand_id_fkey"; columns: ["brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] },
          { foreignKeyName: "user_brands_user_id_fkey"; columns: ["user_id"]; referencedRelation: "users"; referencedColumns: ["id"] }
        ]
      }
      users: {
        Row: {
          id: string
          email: string
          name: string
          role: Database["public"]["Enums"]["user_role"]
          default_brand_id: string | null
          cell_phone: string | null
          avatar_url: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          name: string
          role?: Database["public"]["Enums"]["user_role"]
          default_brand_id?: string | null
          cell_phone?: string | null
          avatar_url?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string
          role?: Database["public"]["Enums"]["user_role"]
          default_brand_id?: string | null
          cell_phone?: string | null
          avatar_url?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "users_default_brand_id_fkey"; columns: ["default_brand_id"]; referencedRelation: "brands"; referencedColumns: ["id"] }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_role: {
        Args: Record<string, never>
        Returns: Database["public"]["Enums"]["user_role"]
      }
    }
    Enums: {
      appointment_status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show"
      appointment_type: "clinic" | "home" | "telehealth"
      call_direction: "inbound" | "outbound"
      call_outcome: "no_answer" | "voicemail" | "connected" | "appointment_set" | "not_interested" | "callback_requested" | "wrong_number"
      lead_source: "inbound_call" | "web_form" | "referral" | "whatsapp" | "walk_in" | "social" | "other"
      lead_status: "new" | "contacted" | "qualified" | "appointment_set" | "sold" | "lost" | "on_hold"
      payment_method: "cash" | "card" | "stripe"
      payment_status: "pending" | "paid" | "failed" | "refunded" | "partial"
      task_priority: "low" | "normal" | "high" | "urgent"
      task_status: "open" | "done" | "snoozed" | "cancelled"
      user_role: "admin" | "manager" | "rep"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
