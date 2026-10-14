"""Exercise both orderings of adoption/removal on an isolated local database.

Usage: python3 tests/database/admin-content-races.py mankunku_admin_<suffix>
Requires the existing local Supabase Docker container and an already migrated,
schema-only test database. This never connects to a hosted project.
"""
import subprocess
import sys
import time

database = sys.argv[1] if len(sys.argv) == 2 else ''
if not database.startswith('mankunku_admin_'):
    raise SystemExit('Pass the name of an isolated mankunku_admin_* database.')
cmd = ['docker', 'exec', '-i', 'supabase_db_mankunku', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1']

def sql(statement):
    return subprocess.run(cmd, input=statement, text=True, capture_output=True, check=True).stdout

admin = '30000000-0000-4000-8000-000000000001'
author = '30000000-0000-4000-8000-000000000002'
adopter = '30000000-0000-4000-8000-000000000003'

def reset():
    sql(f"""DELETE FROM public.admin_actions WHERE actor_id='{admin}';
    DELETE FROM auth.users WHERE id IN ('{admin}','{author}','{adopter}');
    INSERT INTO auth.users(id,email) VALUES ('{admin}','race-admin@example.test'),('{author}','race-author@example.test'),('{adopter}','race-adopter@example.test');
    UPDATE public.user_profiles SET is_admin=true WHERE id='{admin}';
    INSERT INTO public.user_licks(id,user_id,name,time_signature,key) VALUES ('race-lick','{author}','Race lick',ARRAY[4,4],'C');""")

adopt = f"INSERT INTO public.lick_adoptions(user_id,lick_id) VALUES ('{adopter}','race-lick');"
begin = f"SELECT public.admin_begin_user_deletion('{admin}','{author}','race-author@example.test');"
remove = f"SELECT public.admin_remove_lick('{admin}','{author}','race-lick','Race lick');"

for first, second, expected in [(adopt, begin, 'Deletion blocked'), (begin, adopt, 'Account removal is in progress'), (adopt, remove, 'Removal blocked'), (remove, adopt, 'Content unavailable')]:
    reset()
    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write(f"BEGIN; {first} SELECT 'ready'; SELECT pg_sleep(1); COMMIT;\n")
    process.stdin.close()
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(process.stderr.read())
        if line.strip() == 'ready':
            break
    start = time.monotonic()
    result = subprocess.run(cmd, input=second, text=True, capture_output=True)
    process.wait(timeout=10)
    assert process.returncode == 0, process.stderr.read()
    assert result.returncode != 0 and expected in result.stderr, (result.stdout, result.stderr)
    assert time.monotonic() - start > 0.5, 'Second operation did not wait for the first transaction'
    if first == adopt:
        assert sql("SELECT count(*) FROM public.lick_adoptions WHERE lick_id='race-lick';").strip() == '1'
        assert sql("SELECT count(*) FROM public.user_licks WHERE id='race-lick' AND deleted_at IS NULL;").strip() == '1'
    print('PASS:', expected)

sql(f"DELETE FROM public.admin_actions WHERE actor_id='{admin}'; DELETE FROM auth.users WHERE id IN ('{admin}','{author}','{adopter}');")
