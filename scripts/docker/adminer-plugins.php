<?php
namespace docker {
    function adminer_object() {
        class F3AdminerPlugin extends \Adminer\Plugin {
            function permanentLogin($create = false) {
                return "f3-local-dev-key";
            }
            function name() {
                return "F3 Nation DB";
            }
            function credentials() {
                return ['f3-postgres', 'f3local', 'f3local'];
            }
            function login($login, $password) {
                return true;
            }
            function database() {
                return 'f3nation';
            }
        }

        return new \Adminer\Plugins([new F3AdminerPlugin()]);
    }
}

namespace {
    function adminer_object() {
        return \docker\adminer_object();
    }

    // Auto-login: Adminer 6.0.1 added CSRF-token verification to the login
    // POST (and requires Sec-Fetch-Site to be same-origin/empty), so a
    // server-side faked $_POST['auth'] — the pre-6 approach — can no longer
    // authenticate; verify_token() rejects it before credentials() is even
    // consulted. Instead let Adminer render its normal login form (which
    // embeds the session-bound token it expects back) and auto-submit it
    // from the browser, producing a real same-origin POST. After that one
    // login, Adminer's permanent-login cookie takes over and this block
    // never fires again.
    $needsAutoLogin = empty($_POST) && empty($_COOKIE['adminer_permanent']);

    if ($needsAutoLogin) {
        // adminer.php exits directly after rendering the login page, so any
        // code placed after include() below would never run. A shutdown
        // function still fires when the script exits, and the output
        // buffer started here is still open at that point, letting us
        // append to the response body regardless of how adminer.php ends.
        ob_start();
        register_shutdown_function(function () {
            if (!function_exists('Adminer\\get_nonce')) {
                echo ob_get_clean();
                return;
            }
            $html = ob_get_clean();
            $nonce = \Adminer\get_nonce();
            $script = '<script nonce="' . $nonce . '">(function(){'
                . 'var driver=document.querySelector(\'select[name="auth[driver]"]\');'
                . 'if(!driver)return;'
                . 'var form=driver.form;'
                . 'function set(name,val){var el=form.elements[name];if(el)el.value=val;}'
                . 'driver.value="pgsql";'
                . 'driver.dispatchEvent(new Event("change",{bubbles:true}));'
                . 'set("auth[server]","f3-postgres");'
                . 'set("auth[username]","f3local");'
                . 'set("auth[password]","f3local");'
                . 'set("auth[db]","f3nation");'
                . 'var permanent=form.elements["auth[permanent]"];'
                . 'if(permanent)permanent.checked=true;'
                . 'form.submit();'
                . '})();</script>';
            echo $html . $script;
        });
    }

    include './adminer.php';
}
