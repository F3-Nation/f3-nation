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
                return [
                    getenv('ADMINER_SERVER') ?: 'f3-postgres',
                    getenv('ADMINER_USERNAME') ?: 'f3local',
                    getenv('ADMINER_PASSWORD') ?: 'f3local',
                ];
            }
            function login($login, $password) {
                return true;
            }
            function database() {
                return getenv('ADMINER_DATABASE') ?: 'f3nation';
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
            'server'    => getenv('ADMINER_SERVER') ?: 'f3-postgres',
            'username'  => getenv('ADMINER_USERNAME') ?: 'f3local',
            'password'  => getenv('ADMINER_PASSWORD') ?: 'f3local',
            'db'        => getenv('ADMINER_DATABASE') ?: 'f3nation',
            'permanent' => '1',
        ];
        $_SERVER['REQUEST_METHOD'] = 'POST';
    }

    include './adminer.php';
}
