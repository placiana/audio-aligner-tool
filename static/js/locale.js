window.currentLang = localStorage.getItem('aligner_lang') || 'es';

window.translations = {
    en: {
        title: "Audio Aligner",
        projects_title: "Your Workspaces / Projects",
        no_projects: "📁 No projects yet. Create a project on the right to get started!",
        new_project: "New Project",
        project_name: "Project Name",
        description: "Description",
        create_project_btn: "➕ Create Project",
        delete_project_btn: "🗑️ Delete Project",
        project_type_label: "Project Type",
        type_segmentation: "Segmentation Only (Audio)",
        type_transcription: "Segmentation & Transcription (Audio)",
        type_alignment: "Segmentation & Alignment (Audio + Text)",
        save_segment_btn: "Save Segment",
        next_seg_only_btn: "Next Segment",
        completion_seg_only_congrats: "Excellent work! You have completed the segmentation of this audio.",
        tracks_title: "Audio Tracks to Align",
        tracks_title_alignment: "Audio Tracks to Align",
        tracks_title_transcription: "Audio Tracks to Transcribe",
        tracks_title_segmentation: "Audio Tracks to Segment",
        no_tracks: "🎙️ No audio tracks uploaded yet. Use the panel on the right to upload your first audio track.",
        upload_track_title: "Upload Track",
        audio_file_label: "Audio File (.mp3, .wav)",
        text_file_label: "Transcription File (.txt) - Optional",
        text_file_help: "Leave empty if you want to transcribe the audio segments directly in the tool.",
        upload_track_btn: "📤 Upload Track",
        align_btn: "Align",
        align_btn_alignment: "Align",
        align_btn_transcription: "Transcribe",
        align_btn_segmentation: "Segment",
        json_btn: "JSON",
        elan_btn: "ELAN",
        logout_btn: "Logout",
        projects_nav: "📂 Projects",
        login_title: "Sign In",
        username_label: "Username",
        password_label: "Password",
        login_btn: "Sign In",
        new_user_prompt: "New to Audio Aligner?",
        create_account_link: "Create an account",
        register_title: "Create Account",
        register_btn: "Sign Up",
        already_user_prompt: "Already have an account?",
        sign_in_link: "Sign In",
        
        // Editor
        welcome_title: "Select an audio to process",
        download_db: "📥 Download Consolidated Database (JSON)",
        segments_aligned: "segments aligned",
        open_btn: "Open",
        back_to_list: "Back to List",
        reset_btn: "Reset",
        save_btn: "Save",
        stage1_title: "Stage 1: Segmentation",
        file_label: "File:",
        duration_label: "Duration:",
        target_duration: "Target (s):",
        detect_btn: "Detect Segments",
        confirm_btn: "Confirm & Align",
        confirm_btn_alignment: "Confirm & Align",
        confirm_btn_transcription: "Confirm & Transcribe",
        confirm_btn_segmentation: "Confirm & Segment",
        current_segment_title: "Current Segment",
        play_pause: "Play/Pause",
        seg_label: "Seg.",
        prev_btn: "Previous",
        next_btn: "Next",
        transcription_title: "Transcription",
        show_alignments: "View Alignments",
        alignments_modal_title: "Created Alignments",
        completion_title: "🎉 AUDIO ALIGNED SUCCESSFULLY!",
        completion_title_alignment: "🎉 AUDIO ALIGNED SUCCESSFULLY!",
        completion_title_transcription: "🎉 AUDIO TRANSCRIBED SUCCESSFULLY!",
        completion_title_segmentation: "🎉 AUDIO SEGMENTED SUCCESSFULLY!",
        completion_congrats: "Excellent work! You have completed the alignment of this audio.",
        completion_congrats_alignment: "Excellent work! You have completed the alignment of this audio.",
        completion_congrats_transcription: "Excellent work! You have completed the transcription of this audio.",
        completion_congrats_segmentation: "Excellent work! You have completed the segmentation of this audio.",
        completion_instructions: "Review each aligned segment below, listen to the previews to verify synchronization, or return to the list to process a new file.",
        completion_instructions_alignment: "Review each aligned segment below, listen to the previews to verify synchronization, or return to the list to process a new file.",
        completion_instructions_transcription: "Review each transcribed segment below, listen to the previews to verify synchronization, or return to the list to process a new file.",
        completion_instructions_segmentation: "Review each segment below, listen to the previews to verify, or return to the list to process a new file.",
        completion_home: "🏠 Return to Main List",
        completion_review: "🔍 Return to Editor",
        completion_preview_title: "Alignments Preview",
        no_alignments_yet: "No aligned segments yet. Start aligning the transcription!",
        listen_btn: "▶ Listen",
        pause_btn: "⏸ Pause",
        jump_btn: "Go to segment",
        correct_btn: "Edit",
        remaining_text: "Remaining Text",
        reset_confirm: "Are you sure you want to go back to segmentation? All text assigned to the current segments will be lost.",
        select_text_alert: "Please select the text corresponding to this segment or type the transcription manually.",
        this_seg_badge: "This Seg.",
        seg_badge_prefix: "Seg. ",
        assign_highlight_btn: "Assign Highlight (Ctrl + Enter)",
        next_seg_btn: "Next Segment (Ctrl + Enter)",
        select_and_assign_btn: "Select text above and assign",
        segments_created: "segments created",
        segments_transcribed: "segments transcribed",
        segments_aligned: "segments aligned",
        waveform_zoom: "🔍 Waveform Zoom:",
        min_silence: "Min Silence (ms):",
        silence_threshold: "Silence Threshold (dB):",
        zoom: "🔍 Zoom:",
        segment_prefix: "SEGMENT",
        fine_tune: "Fine-tune:",
        adj_start_minus: "Start -0.1s",
        adj_start_plus: "Start +0.1s",
        adj_end_minus: "End -0.1s",
        adj_end_plus: "End +0.1s",
        active_segment_transcription_label: "Active Segment Transcription text:",
        active_segment_transcription_placeholder: "Type transcription for this segment here..."
    },
    es: {
        title: "Audio Aligner",
        projects_title: "Tus Espacios de Trabajo / Proyectos",
        no_projects: "📁 Aún no hay proyectos. ¡Crea un proyecto a la derecha para comenzar!",
        new_project: "Nuevo Proyecto",
        project_name: "Nombre del Proyecto",
        description: "Descripción",
        create_project_btn: "➕ Crear Proyecto",
        delete_project_btn: "🗑️ Eliminar Proyecto",
        project_type_label: "Tipo de Proyecto",
        type_segmentation: "Solo segmentación (Audio)",
        type_transcription: "Segmentación y transcripción (Audio)",
        type_alignment: "Segmentación y alineamiento (Audio + Texto)",
        save_segment_btn: "Guardar Segmento",
        next_seg_only_btn: "Siguiente Segmento",
        completion_seg_only_congrats: "¡Excelente trabajo! Has completado la segmentación de este audio.",
        tracks_title: "Pistas de Audio para Alinear",
        tracks_title_alignment: "Pistas de Audio para Alinear",
        tracks_title_transcription: "Pistas de Audio para Transcribir",
        tracks_title_segmentation: "Pistas de Audio para Segmentar",
        no_tracks: "🎙️ Aún no hay pistas de audio subidas. Usa el panel de la derecha para subir tu primera pista.",
        upload_track_title: "Subir Pista",
        audio_file_label: "Archivo de Audio (.mp3, .wav)",
        text_file_label: "Archivo de Transcripción (.txt) - Opcional",
        text_file_help: "Déjalo vacío si quieres transcribir los segmentos de audio directamente en la herramienta.",
        upload_track_btn: "📤 Subir Pista",
        align_btn: "Alinear",
        align_btn_alignment: "Alinear",
        align_btn_transcription: "Transcribir",
        align_btn_segmentation: "Segmentar",
        json_btn: "JSON",
        elan_btn: "ELAN",
        logout_btn: "Cerrar sesión",
        projects_nav: "📂 Proyectos",
        login_title: "Iniciar Sesión",
        username_label: "Usuario",
        password_label: "Contraseña",
        login_btn: "Iniciar Sesión",
        new_user_prompt: "¿Nuevo en Audio Aligner?",
        create_account_link: "Crear una cuenta",
        register_title: "Crear Cuenta",
        register_btn: "Registrarse",
        already_user_prompt: "¿Ya tienes una cuenta?",
        sign_in_link: "Iniciar Sesión",
        
        // Editor
        welcome_title: "Selecciona un audio para procesar",
        download_db: "📥 Descargar Base de Datos Consolidada (JSON)",
        segments_aligned: "segmentos alineados",
        open_btn: "Abrir",
        back_to_list: "Volver al listado",
        reset_btn: "Reiniciar",
        save_btn: "Guardar",
        stage1_title: "Fase 1: Segmentación",
        file_label: "Archivo:",
        duration_label: "Duración:",
        target_duration: "Duración obj. (s):",
        detect_btn: "Detectar Segmentos",
        confirm_btn: "Confirmar y Alinear",
        confirm_btn_alignment: "Confirmar y Alinear",
        confirm_btn_transcription: "Confirmar y Transcribir",
        confirm_btn_segmentation: "Confirmar y Segmentar",
        current_segment_title: "Segmento Actual",
        play_pause: "Reproducir/Pausa",
        seg_label: "Seg.",
        prev_btn: "Anterior",
        next_btn: "Siguiente",
        transcription_title: "Transcripción",
        show_alignments: "Ver Alineamientos",
        alignments_modal_title: "Alineamientos Realizados",
        completion_title: "🎉 ¡AUDIO ALINEADO CON ÉXITO!",
        completion_title_alignment: "🎉 ¡AUDIO ALINEADO CON ÉXITO!",
        completion_title_transcription: "🎉 ¡AUDIO TRANSCRITO CON ÉXITO!",
        completion_title_segmentation: "🎉 ¡AUDIO SEGMENTADO CON ÉXITO!",
        completion_congrats: "¡Excelente trabajo! Has completado la alineación de este audio.",
        completion_congrats_alignment: "¡Excelente trabajo! Has completado la alineación de este audio.",
        completion_congrats_transcription: "¡Excelente trabajo! Has completado la transcripción de este audio.",
        completion_congrats_segmentation: "¡Excelente trabajo! Has completado la segmentación de este audio.",
        completion_instructions: "Revisa a continuación cada uno de los segmentos alineados, escucha las pistas previas para verificar la sincronización o vuelve al listado para procesar un nuevo archivo.",
        completion_instructions_alignment: "Revisa a continuación cada uno de los segmentos alineados, escucha las pistas previas para verificar la sincronización o vuelve al listado para procesar un nuevo archivo.",
        completion_instructions_transcription: "Revisa a continuación cada uno de los segmentos transcritos, escucha las pistas previas para verificar la sincronización o vuelve al listado para procesar un nuevo archivo.",
        completion_instructions_segmentation: "Revisa a continuación cada uno de los segmentos creados, escucha las pistas previas para verificar o vuelve al listado para procesar un nuevo archivo.",
        completion_home: "🏠 Volver al Listado Principal",
        completion_review: "🔍 Volver al Editor",
        completion_preview_title: "Vista Previa de Alineamientos",
        no_alignments_yet: "No hay segmentos alineados todavía. ¡Comienza a alinear la transcripción!",
        listen_btn: "▶ Escuchar",
        pause_btn: "⏸ Pausa",
        jump_btn: "Ir a segmento",
        correct_btn: "Corregir",
        remaining_text: "Texto Restante",
        reset_confirm: "¿Estás seguro de que quieres volver a la segmentación? Se perderá todo el texto asignado a los segmentos actuales.",
        select_text_alert: "Por favor, selecciona con el ratón el texto correspondiente a este segmento o escríbelo manualmente.",
        this_seg_badge: "Este Seg.",
        seg_badge_prefix: "Seg. ",
        assign_highlight_btn: "Asignar Selección (Ctrl + Enter)",
        next_seg_btn: "Siguiente Segmento (Ctrl + Enter)",
        select_and_assign_btn: "Selecciona texto arriba y asigna",
        segments_created: "segmentos creados",
        segments_transcribed: "segmentos transcritos",
        segments_aligned: "segmentos alineados",
        waveform_zoom: "🔍 Zoom del audio:",
        min_silence: "Silencio mín. (ms):",
        silence_threshold: "Umbral de silencio (dB):",
        zoom: "🔍 Zoom:",
        segment_prefix: "SEGMENTO",
        fine_tune: "Ajuste fino:",
        adj_start_minus: "Inicio -0.1s",
        adj_start_plus: "Inicio +0.1s",
        adj_end_minus: "Fin -0.1s",
        adj_end_plus: "Fin +0.1s",
        active_segment_transcription_label: "Texto de transcripción del segmento activo:",
        active_segment_transcription_placeholder: "Escribe aquí la transcripción de este segmento..."
    }
};

window.updateLanguageUI = function() {
    const langBtn = document.getElementById('lang-toggle-btn');
    if (langBtn) {
        langBtn.innerText = window.currentLang === 'en' ? '🌐 ES' : '🌐 EN';
    }

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (window.translations[window.currentLang] && window.translations[window.currentLang][key]) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = window.translations[window.currentLang][key];
            } else {
                el.innerText = window.translations[window.currentLang][key];
            }
        }
    });

    // Translate dynamic segment status texts on dashboard/projects list
    document.querySelectorAll('.aligned-status-text').forEach(el => {
        const completed = el.getAttribute('data-completed');
        const total = el.getAttribute('data-total');
        const projectType = el.getAttribute('data-project-type') || 'alignment';
        let text = '';
        if (projectType === 'segmentation') {
            const translatedSuffix = window.translations[window.currentLang].segments_created || 'segments created';
            text = `${total} ${translatedSuffix}`;
        } else if (projectType === 'transcription') {
            const translatedSuffix = window.translations[window.currentLang].segments_transcribed || 'segments transcribed';
            text = `${completed} / ${total} ${translatedSuffix}`;
        } else {
            const translatedSuffix = window.translations[window.currentLang].segments_aligned || 'segments aligned';
            text = `${completed} / ${total} ${translatedSuffix}`;
        }
        el.innerText = text;
    });
};

window.toggleLanguage = function() {
    window.currentLang = window.currentLang === 'en' ? 'es' : 'en';
    localStorage.setItem('aligner_lang', window.currentLang);
    window.updateLanguageUI();
    
    // Dispatch a custom event to notify main.js if it is running on this page
    window.dispatchEvent(new Event('languagechanged'));
};

document.addEventListener('DOMContentLoaded', () => {
    window.updateLanguageUI();
    document.getElementById('lang-toggle-btn')?.addEventListener('click', window.toggleLanguage);
});
