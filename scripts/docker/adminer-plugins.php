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

    // Auto-login: on a fresh visit (no active session, no permanent cookie),
    // fake a POST auth so adminer logs in and sets a permanent cookie.
    // After the first successful login the permanent cookie takes over and
    // this block never runs again.
    if (empty($_GET['username']) && empty($_POST['auth']) && empty($_COOKIE['adminer_permanent'])) {
        $_POST['auth'] = [
            'driver'    => 'pgsql',
            'server'    => 'f3-postgres',
            'username'  => 'f3local',
            'password'  => 'f3local',
            'db'        => 'f3nation',
            'permanent' => '1',
        ];
        $_SERVER['REQUEST_METHOD'] = 'POST';
    }

    include './adminer.php';
}
