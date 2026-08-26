import os
import sqlite3
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

DATABASE_FILE = os.environ.get('DATABASE_FILE', 'aligner.db')

def get_db_connection():
    db_dir = os.path.dirname(DATABASE_FILE)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    # Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Users Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    ''')
    
    # Projects Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            type TEXT NOT NULL DEFAULT 'alignment',
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    ''')
    
    # Collaborators Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_collaborators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    ''')
    
    # AudioItems Table (Audio/Text Alignment entities)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS audio_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            audio_path TEXT NOT NULL,
            text_path TEXT NOT NULL,
            state_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
    ''')
    
    # Check if 'is_admin' column exists in 'users' table (migration for existing database files)
    cursor.execute("PRAGMA table_info(users);")
    columns = [row['name'] for row in cursor.fetchall()]
    if 'is_admin' not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;")
    if 'theme' not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'neo-brutalist';")
    if 'google_id' not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN google_id TEXT;")
    if 'email' not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN email TEXT;")
        
    # Check if 'type' column exists in 'projects' table (migration for existing database files)
    cursor.execute("PRAGMA table_info(projects);")
    columns = [row['name'] for row in cursor.fetchall()]
    if 'type' not in columns:
        cursor.execute("ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'alignment';")
    
    conn.commit()
    conn.close()

# --- User Functions ---

def create_user(username, password):
    conn = get_db_connection()
    cursor = conn.cursor()
    password_hash = generate_password_hash(password)
    try:
        cursor.execute('SELECT COUNT(*) FROM users')
        user_count = cursor.fetchone()[0]
        is_admin = 1 if user_count == 0 else 0
        
        cursor.execute(
            'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
            (username, password_hash, is_admin)
        )
        conn.commit()
        user_id = cursor.lastrowid
        return user_id
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def verify_user(username, password):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE username = ?', (username,))
    user = cursor.fetchone()
    conn.close()
    
    if user and check_password_hash(user['password_hash'], password):
        return dict(user)
    return None

def get_user_by_id(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    if user:
        return dict(user)
    return None

def get_user_by_google_id(google_id):
    if not google_id:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE google_id = ?', (google_id,))
    user = cursor.fetchone()
    conn.close()
    if user:
        return dict(user)
    return None

def get_user_by_email(email):
    if not email:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    if user:
        return dict(user)
    return None

def link_google_id(user_id, google_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET google_id = ? WHERE id = ?', (google_id, user_id))
    conn.commit()
    conn.close()

def create_google_user(username, email, google_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT COUNT(*) FROM users')
        user_count = cursor.fetchone()[0]
        is_admin = 1 if user_count == 0 else 0
        
        # Unique username check / adjustment
        base_username = username or (email.split('@')[0] if email else 'user')
        final_username = base_username
        counter = 1
        while True:
            cursor.execute('SELECT id FROM users WHERE username = ?', (final_username,))
            if not cursor.fetchone():
                break
            final_username = f"{base_username}_{counter}"
            counter += 1

        cursor.execute(
            'INSERT INTO users (username, password_hash, is_admin, google_id, email) VALUES (?, ?, ?, ?, ?)',
            (final_username, '', is_admin, google_id, email)
        )
        conn.commit()
        user_id = cursor.lastrowid
        return user_id
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def update_user_password(user_id, new_password):
    conn = get_db_connection()
    cursor = conn.cursor()
    password_hash = generate_password_hash(new_password)
    cursor.execute(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        (password_hash, user_id)
    )
    conn.commit()
    rows = cursor.rowcount
    conn.close()
    return rows > 0

def update_user_theme(user_id, theme):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE users SET theme = ? WHERE id = ?',
        (theme, user_id)
    )
    conn.commit()
    rows = cursor.rowcount
    conn.close()
    return rows > 0

# --- Project Functions ---

def create_project(name, description, project_type, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO projects (name, description, type, user_id) VALUES (?, ?, ?, ?)',
        (name, description, project_type, user_id)
    )
    conn.commit()
    project_id = cursor.lastrowid
    conn.close()
    return project_id

def list_projects(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT p.*, 'owner' as user_role 
        FROM projects p 
        WHERE p.user_id = ?
        UNION
        SELECT p.*, pc.role as user_role 
        FROM projects p 
        JOIN project_collaborators pc ON p.id = pc.project_id 
        WHERE pc.user_id = ?
        ORDER BY created_at DESC
    ''', (user_id, user_id))
    projects = cursor.fetchall()
    conn.close()
    return [dict(p) for p in projects]

def get_project(project_id, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,))
    project_row = cursor.fetchone()
    if not project_row:
        conn.close()
        return None
        
    project = dict(project_row)
    if project['user_id'] == user_id:
        project['user_role'] = 'owner'
        conn.close()
        return project
        
    cursor.execute('SELECT role FROM project_collaborators WHERE project_id = ? AND user_id = ?', (project_id, user_id))
    collab = cursor.fetchone()
    conn.close()
    if collab:
        project['user_role'] = collab['role']
        return project
        
    return None

def delete_project(project_id, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM projects WHERE id = ? AND user_id = ?', (project_id, user_id))
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    return rows_affected > 0

# --- Audio Item Functions ---

def create_audio_item(project_id, audio_path, text_path, state_json="{}"):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO audio_items (project_id, audio_path, text_path, state_json) VALUES (?, ?, ?, ?)',
        (project_id, audio_path, text_path, state_json)
    )
    conn.commit()
    item_id = cursor.lastrowid
    conn.close()
    return item_id

def list_audio_items(project_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM audio_items WHERE project_id = ? ORDER BY created_at DESC', (project_id,))
    items = cursor.fetchall()
    conn.close()
    return [dict(i) for i in items]

def get_audio_item(item_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM audio_items WHERE id = ?', (item_id,))
    item = cursor.fetchone()
    conn.close()
    if item:
        return dict(item)
    return None

def update_audio_item_state(item_id, state_json):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE audio_items SET state_json = ? WHERE id = ?',
        (state_json, item_id)
    )
    conn.commit()
    conn.close()

def delete_audio_item(item_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM audio_items WHERE id = ?', (item_id,))
    conn.commit()
    conn.close()

# --- Admin CRUD Functions ---

def list_all_users():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, username, is_admin, created_at FROM users ORDER BY username ASC')
    users = cursor.fetchall()
    conn.close()
    return [dict(u) for u in users]

def update_user_admin(user_id, username, is_admin):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE users SET username = ?, is_admin = ? WHERE id = ?',
        (username, is_admin, user_id)
    )
    conn.commit()
    conn.close()

def delete_user_admin(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()

def list_all_projects_admin():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT p.*, u.username as owner_name 
        FROM projects p 
        LEFT JOIN users u ON p.user_id = u.id 
        ORDER BY p.created_at DESC
    ''')
    projects = cursor.fetchall()
    conn.close()
    return [dict(p) for p in projects]

def update_project_admin(project_id, name, description, project_type, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE projects SET name = ?, description = ?, type = ?, user_id = ? WHERE id = ?',
        (name, description, project_type, user_id, project_id)
    )
    conn.commit()
    conn.close()

def delete_project_admin(project_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM projects WHERE id = ?', (project_id,))
    conn.commit()
    conn.close()

def list_all_audio_items_admin():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT a.*, p.name as project_name 
        FROM audio_items a 
        LEFT JOIN projects p ON a.project_id = p.id 
        ORDER BY a.created_at DESC
    ''')
    items = cursor.fetchall()
    conn.close()
    return [dict(i) for i in items]

def update_audio_item_admin(item_id, project_id, audio_path, text_path, state_json):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE audio_items SET project_id = ?, audio_path = ?, text_path = ?, state_json = ? WHERE id = ?',
        (project_id, audio_path, text_path, state_json, item_id)
    )
    conn.commit()
    conn.close()

def get_project_admin(project_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,))
    project = cursor.fetchone()
    conn.close()
    if project:
        return dict(project)
    return None

def create_user_admin(username, password, is_admin):
    conn = get_db_connection()
    cursor = conn.cursor()
    password_hash = generate_password_hash(password)
    try:
        cursor.execute(
            'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
            (username, password_hash, is_admin)
        )
        conn.commit()
        user_id = cursor.lastrowid
        return user_id
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

# --- Collaborators Functions ---

def list_collaborators(project_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT u.id as user_id, u.username, 'owner' as role 
        FROM projects p 
        JOIN users u ON p.user_id = u.id 
        WHERE p.id = ?
    ''', (project_id,))
    owner = cursor.fetchone()
    
    cursor.execute('''
        SELECT u.id as user_id, u.username, pc.role 
        FROM project_collaborators pc 
        JOIN users u ON pc.user_id = u.id 
        WHERE pc.project_id = ?
    ''', (project_id,))
    collabs = cursor.fetchall()
    conn.close()
    
    result = []
    if owner:
        result.append(dict(owner))
    result.extend([dict(c) for c in collabs])
    return result

def add_collaborator(project_id, username, role):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
    user = cursor.fetchone()
    if not user:
        conn.close()
        return {'success': False, 'error': 'user_not_found'}
        
    user_id = user['id']
    cursor.execute('SELECT user_id FROM projects WHERE id = ?', (project_id,))
    proj = cursor.fetchone()
    if proj and proj['user_id'] == user_id:
        conn.close()
        return {'success': False, 'error': 'is_owner'}
        
    try:
        cursor.execute(
            'INSERT INTO project_collaborators (project_id, user_id, role) VALUES (?, ?, ?)',
            (project_id, user_id, role)
        )
        conn.commit()
        conn.close()
        return {'success': True}
    except sqlite3.IntegrityError:
        conn.close()
        return {'success': False, 'error': 'already_collaborator'}

def update_collaborator_role(project_id, user_id, role):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE project_collaborators SET role = ? WHERE project_id = ? AND user_id = ?',
        (role, project_id, user_id)
    )
    conn.commit()
    rows = cursor.rowcount
    conn.close()
    return rows > 0

def delete_collaborator(project_id, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'DELETE FROM project_collaborators WHERE project_id = ? AND user_id = ?',
        (project_id, user_id)
    )
    conn.commit()
    rows = cursor.rowcount
    conn.close()
    return rows > 0

def search_users_for_autocomplete(query, exclude_user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'SELECT username FROM users WHERE username LIKE ? AND id != ? LIMIT 10',
        ('%' + query + '%', exclude_user_id)
    )
    rows = cursor.fetchall()
    conn.close()
    return [row['username'] for row in rows]
